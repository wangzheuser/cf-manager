import { incrementQuota, getAllQuotaToday, getQuotaByAccount, setQuota } from '../models/quotaUsage';
import { getActiveAccounts } from '../models/account';
import { getAiUsageToday } from './aiService';
import { getWorkersUsageToday } from './workerService';

export type ResourceType = 'workers_requests' | 'ai_neurons' | 'browser_render_seconds';

const LIMITS: Record<string, number> = {
  workers_requests: 100000,
  ai_neurons: 10000,
  browser_render_seconds: 600,
};

export function trackUsage(accountId: number, resource: ResourceType, amount: number = 1): void {
  incrementQuota(accountId, resource, amount);
}

export async function syncUsageFromCloudflare(): Promise<void> {
  const accounts = getActiveAccounts();

  await Promise.all(accounts.map(async (account) => {
    try {
      const aiUsage = await getAiUsageToday(account);
      setQuota(account.id, 'ai_neurons', Math.round(aiUsage.totalNeurons));
    } catch (e) {
      console.error(`[Sync] AI usage failed for ${account.name}:`, e);
    }

    try {
      const workersUsage = await getWorkersUsageToday(account);
      setQuota(account.id, 'workers_requests', workersUsage.requests);
    } catch (e) {
      console.error(`[Sync] Workers usage failed for ${account.name}:`, e);
    }
  }));
}

export function getQuotaSummary() {
  const accounts = getActiveAccounts();
  const usage = getAllQuotaToday();
  const resourceTypes = Object.keys(LIMITS) as ResourceType[];

  return accounts.map(account => {
    const resources = resourceTypes.map(resource => {
      const row = usage.find(u => u.account_id === account.id && u.resource === resource);
      const count = row?.count || 0;
      const limit = LIMITS[resource];
      return { resource, count, limit, remaining: Math.max(0, limit - count) };
    });
    return { accountId: account.id, accountName: account.name, resources };
  });
}

export function getAccountQuota(accountId: number, resource: ResourceType): { used: number; remaining: number } {
  const today = new Date().toISOString().split('T')[0];
  const usage = getQuotaByAccount(accountId, resource, today);
  const used = usage?.count || 0;
  const limit = LIMITS[resource] || 0;
  return { used, remaining: Math.max(0, limit - used) };
}
