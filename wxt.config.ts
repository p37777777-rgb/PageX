import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  alias: {
    '@': resolve('src'),
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Pagent',
    description: 'PageX正在操纵当前页面',
    permissions: [
      'storage',
      'unlimitedStorage',
      'scripting',
      'activeTab',
      'debugger'
    ],
    optional_permissions: ['tabs', 'downloads'],
    host_permissions: ['<all_urls>'],
    commands: {
      'toggle-pagent': {
        suggested_key: { default: 'Alt+P' },
        description: '显示或隐藏 Pagent',
      },
    },
  },
});
