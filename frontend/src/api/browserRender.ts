import apiClient from './client';

export type RenderMode = 'screenshot' | 'content' | 'markdown' | 'pdf' | 'links';

export const browserRenderApi = {
  render: (url: string, mode: RenderMode = 'screenshot', accountId?: number) =>
    apiClient.post('/browser-render', { url, mode, accountId }),
  getQuota: () => apiClient.get('/quota'),
};
