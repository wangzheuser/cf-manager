import apiClient from './client';

export const dnsApi = {
  getDomains: () => apiClient.get('/dns/domains'),
  getRecords: (domain: string) => apiClient.get(`/dns/domains/${domain}/records`),
  createRecord: (domain: string, data: any) => apiClient.post(`/dns/domains/${domain}/records`, data),
  updateRecord: (domain: string, id: string, data: any) => apiClient.put(`/dns/domains/${domain}/records/${id}`, data),
  deleteRecord: (domain: string, id: string) => apiClient.delete(`/dns/domains/${domain}/records/${id}`),
  getSettings: (domain: string) => apiClient.get(`/dns/domains/${domain}/settings`),
  updateProxy: (domain: string, recordId: string, proxied: boolean) => apiClient.patch(`/dns/domains/${domain}/proxy`, { record_id: recordId, proxied }),
};
