import apiClient from './client';

export const aiApi = {
  getModels: (params?: Record<string, string>) => apiClient.get('/ai/models', { params }),
  inference: (model: string, prompt: string, accountId?: number) =>
    apiClient.post('/ai/inference', { model, prompt, accountId }),
  getUsage: () => apiClient.get('/ai/usage'),
};
