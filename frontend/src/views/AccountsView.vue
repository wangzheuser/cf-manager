<template>
  <div>
    <n-space justify="space-between" align="center">
      <n-h2>账号管理</n-h2>
      <n-button type="primary" @click="showAddModal = true">添加账号</n-button>
    </n-space>

    <n-data-table
      :columns="columns"
      :data="accountStore.accounts"
      :loading="accountStore.loading"
      :bordered="false"
    />

    <n-modal v-model:show="showAddModal" preset="dialog" title="添加账号" style="width: 500px">
      <n-form :model="form" label-placement="left" label-width="100">
        <n-form-item label="名称">
          <n-input v-model:value="form.name" placeholder="账号名称" />
        </n-form-item>
        <n-form-item label="认证类型">
          <n-select v-model:value="form.auth_type" :options="authTypeOptions" />
        </n-form-item>
        <n-form-item v-if="form.auth_type === 'token'" label="API Token">
          <n-input v-model:value="form.api_token" type="password" show-password-on="click" placeholder="Cloudflare API Token" />
        </n-form-item>
        <n-form-item v-if="form.auth_type === 'global_key'" label="API Key">
          <n-input v-model:value="form.api_key" type="password" show-password-on="click" placeholder="Cloudflare API Key" />
        </n-form-item>
        <n-form-item v-if="form.auth_type === 'global_key'" label="Email">
          <n-input v-model:value="form.email" placeholder="Cloudflare 账号邮箱" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="showAddModal = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleAdd">提交</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, h, onMounted } from 'vue';
import { NButton, NSpace, NTag, useMessage } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { useAccountStore } from '../stores/accountStore';

const accountStore = useAccountStore();
const message = useMessage();
const showAddModal = ref(false);
const submitting = ref(false);

const form = ref({
  name: '',
  auth_type: 'token',
  api_token: '',
  api_key: '',
  email: '',
});

const authTypeOptions = [
  { label: 'API Token', value: 'token' },
  { label: 'API Key + Email', value: 'global_key' },
];

function resetForm() {
  form.value = { name: '', auth_type: 'token', api_token: '', api_key: '', email: '' };
}

async function handleAdd() {
  if (!form.value.name) {
    message.warning('请输入账号名称');
    return;
  }
  submitting.value = true;
  try {
    await accountStore.createAccount(form.value);
    message.success('账号添加成功');
    showAddModal.value = false;
    resetForm();
  } finally {
    submitting.value = false;
  }
}

async function handleTest(row: any) {
  await accountStore.testAccount(row.id);
  message.success('连接测试成功');
}

async function handleDelete(row: any) {
  await accountStore.deleteAccount(row.id);
  message.success('已删除');
}

const columns: DataTableColumns<any> = [
  { title: 'ID', key: 'id', width: 60 },
  { title: '名称', key: 'name', width: 150 },
  { title: '认证类型', key: 'auth_type', width: 140, render: (row) => h(NTag, { size: 'small', type: row.auth_type === 'token' ? 'info' : 'warning' }, { default: () => row.auth_type === 'token' ? 'API Token' : 'Global Key + Email' }) },
  { title: '状态', key: 'is_active', width: 100, render: (row) => h(NTag, { size: 'small', type: row.is_active ? 'success' : 'default' }, { default: () => row.is_active ? '活跃' : '未验证' }) },
  {
    title: '操作', key: 'actions', width: 160,
    render: (row) => h(NSpace, null, {
      default: () => [
        h(NButton, { size: 'small', onClick: () => handleTest(row) }, { default: () => '测试' }),
        h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row) }, { default: () => '删除' }),
      ],
    }),
  },
];

onMounted(() => {
  accountStore.fetchAccounts();
});
</script>
