import { defineStore } from 'pinia';
import { ref } from 'vue';
import { dnsApi } from '../api/dns';

export const useDnsStore = defineStore('dns', () => {
  const domains = ref<any[]>([]);
  const records = ref<any[]>([]);
  const currentDomain = ref('');
  const loading = ref(false);

  async function fetchDomains() {
    loading.value = true;
    try {
      const { data } = await dnsApi.getDomains();
      domains.value = data;
    } catch {
      domains.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function fetchRecords(domain: string) {
    loading.value = true;
    currentDomain.value = domain;
    try {
      const { data } = await dnsApi.getRecords(domain);
      records.value = data;
    } catch {
      records.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { domains, records, currentDomain, loading, fetchDomains, fetchRecords };
});
