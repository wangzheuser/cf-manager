import { getActiveAccounts, Account } from '../models/account';
import { getAccountQuota } from './quotaTracker';
import { setQuota } from '../models/quotaUsage';
import { clearCache } from './accountRouter';

const TOKEN_INTERVAL_MS = 10_000;

interface AccountBucket {
  accountId: number;
  lastUsedAt: number;
  exhausted: boolean;
}

const buckets = new Map<number, AccountBucket>();

function ensureBuckets(): void {
  const accounts = getActiveAccounts();
  for (const acct of accounts) {
    if (!buckets.has(acct.id)) {
      buckets.set(acct.id, { accountId: acct.id, lastUsedAt: 0, exhausted: false });
    }
  }
  for (const [id] of buckets) {
    if (!accounts.find(a => a.id === id)) {
      buckets.delete(id);
    }
  }
}

export function markAccountExhausted(accountId: number): void {
  const bucket = buckets.get(accountId);
  if (bucket) bucket.exhausted = true;
  setQuota(accountId, 'browser_render_seconds', 600);
  clearCache();
  console.log(`[BrowserRL] Account ${accountId} marked as exhausted`);
}

export type AcquireResult =
  | { type: 'ok'; account: Account }
  | { type: 'rate_limited'; waitMs: number }
  | { type: 'all_exhausted' };

export function acquireToken(): AcquireResult {
  ensureBuckets();
  const accounts = getActiveAccounts();
  const now = Date.now();

  let shortestWait = Infinity;
  let hasAvailableAccount = false;

  for (const account of accounts) {
    const bucket = buckets.get(account.id);
    if (!bucket || bucket.exhausted) continue;

    const { remaining } = getAccountQuota(account.id, 'browser_render_seconds');
    if (remaining <= 0) {
      bucket.exhausted = true;
      continue;
    }

    hasAvailableAccount = true;
    const elapsed = now - bucket.lastUsedAt;

    if (elapsed >= TOKEN_INTERVAL_MS) {
      // 立即消费令牌，设置 lastUsedAt = now（不堆叠，不管空闲了多久都只给1个）
      bucket.lastUsedAt = now;
      return { type: 'ok', account };
    }

    const waitMs = TOKEN_INTERVAL_MS - elapsed;
    if (waitMs < shortestWait) {
      shortestWait = waitMs;
    }
  }

  if (!hasAvailableAccount) {
    return { type: 'all_exhausted' };
  }

  return { type: 'rate_limited', waitMs: shortestWait };
}
