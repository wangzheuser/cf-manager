import apiClient from './client';

export const accountsApi = {
  getAll: () => apiClient.get('/accounts'),
  create: (data: any) => apiClient.post('/accounts', data),
  delete: (id: number) => apiClient.delete(`/accounts/${id}`),
  test: (id: number) => apiClient.post(`/accounts/${id}/test`),
};
