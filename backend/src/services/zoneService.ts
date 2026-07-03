import { Account } from '../models/account';
import { getCfClient } from './cfFactory';

export async function getZoneSettings(account: Account, zoneId: string): Promise<any> {
  const cf = getCfClient(account);
  const zone = await cf.zones.get({ zone_id: zoneId } as any);
  return zone;
}

export async function updateProxyStatus(account: Account, zoneId: string, recordId: string, proxied: boolean): Promise<void> {
  const cf = getCfClient(account);
  await cf.dns.records.edit(recordId, { zone_id: zoneId, proxied } as any);
}
