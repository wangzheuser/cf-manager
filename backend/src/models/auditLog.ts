import { getDb } from '../db';

export interface AuditLog {
  id: number;
  account_id: number | null;
  action: string;
  target: string | null;
  detail: string | null;
  status: 'success' | 'error';
  created_at: string;
}

export function createAuditLog(
  accountId: number | null,
  action: string,
  target: string | null,
  detail: string | null,
  status: 'success' | 'error'
): void {
  getDb()
    .prepare('INSERT INTO audit_log (account_id, action, target, detail, status) VALUES (?, ?, ?, ?, ?)')
    .run(accountId, action, target, detail, status);
}

export function getRecentLogs(limit: number = 20): AuditLog[] {
  return getDb()
    .prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?')
    .all(limit) as AuditLog[];
}
