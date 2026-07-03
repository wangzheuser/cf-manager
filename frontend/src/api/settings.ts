import apiClient from './client';

export const settingsApi = {
  get: () => apiClient.get('/settings'),
  clearCache: () => apiClient.post('/settings/cache/clear'),
  testProxy: (proxyUrl: string) => apiClient.post('/settings/proxy/test', { proxy_url: proxyUrl }),
};
