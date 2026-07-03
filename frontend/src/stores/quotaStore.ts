import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../api/client';

export const useQuotaStore = defineStore('quota', () => {
  const quota = ref<any[]>([]);
  const loading = ref(false);

  async function fetchQuota() {
    loading.value = true;
    try {
      const { data } = await apiClient.get('/quota');
      quota.value = data;
    } catch {
      quota.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { quota, loading, fetchQuota };
});
