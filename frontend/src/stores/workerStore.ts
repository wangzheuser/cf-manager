import { defineStore } from 'pinia';
import { ref } from 'vue';
import { workersApi } from '../api/workers';

export const useWorkerStore = defineStore('workers', () => {
  const workers = ref<any[]>([]);
  const loading = ref(false);

  async function fetchWorkers() {
    loading.value = true;
    try {
      const { data } = await workersApi.getAll();
      workers.value = data;
    } catch {
      workers.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { workers, loading, fetchWorkers };
});
