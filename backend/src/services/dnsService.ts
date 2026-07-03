import { Account } from '../models/account';
import { getCfClient } from './cfFactory';

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number;
}

export async function listDnsRecords(account: Account, zoneId: string): Promise<DnsRecord[]> {
  const cf = getCfClient(account);
  const records: DnsRecord[] = [];
  for await (const record of cf.dns.records.list({ zone_id: zoneId, per_page: 100 })) {
    records.push(record as any);
  }
  return records;
}

export async function createDnsRecord(account: Account, zoneId: string, data: Partial<DnsRecord>): Promise<DnsRecord> {
  const cf = getCfClient(account);
  return await cf.dns.records.create({ zone_id: zoneId, ...data } as any) as any;
}

export async function updateDnsRecord(account: Account, zoneId: string, recordId: string, data: Partial<DnsRecord>): Promise<DnsRecord> {
  const cf = getCfClient(account);
  return await cf.dns.records.edit(recordId, { zone_id: zoneId, ...data } as any) as any;
}

export async function deleteDnsRecord(account: Account, zoneId: string, recordId: string): Promise<void> {
  const cf = getCfClient(account);
  await cf.dns.records.delete(recordId, { zone_id: zoneId });
}
