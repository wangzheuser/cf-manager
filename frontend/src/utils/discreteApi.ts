import { createDiscreteApi, darkTheme } from 'naive-ui';
import type { ConfigProviderProps } from 'naive-ui';
import { computed, ref } from 'vue';

const themeRef = ref<'light' | 'dark'>('light');

const configProviderProps = computed<ConfigProviderProps>(() => ({
  theme: themeRef.value === 'dark' ? darkTheme : undefined,
}));

const { message, notification, dialog, loadingBar } = createDiscreteApi(
  ['message', 'notification', 'dialog', 'loadingBar'],
  { configProviderProps }
);

export function setDiscreteTheme(dark: boolean) {
  themeRef.value = dark ? 'dark' : 'light';
}

export { message, notification, dialog, loadingBar };
