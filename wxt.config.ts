import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  outDirTemplate: '.',
  modules: ['@wxt-dev/module-react'],
  alias: {
    '@': resolve('src'),
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src'),
        // 浏览器构建里把 node 内置模块指到空实现，防止误打包真实 fs/path
        'node:fs': resolve('src/shims/node-fs.ts'),
        'node:path': resolve('src/shims/node-path.ts'),
      },
    },
  }),
  manifest: {
    name: 'PageX',
    description: 'PageX正在操纵当前页面',
    minimum_chrome_version: '125',
    permissions: [
      'storage',
      'unlimitedStorage',
      'scripting',
      'activeTab',
      'debugger',
    ],
    optional_permissions: ['tabs', 'downloads'],
    optional_host_permissions: [
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://api.deepseek.com/*',
      'https://api.moonshot.cn/*',
      'https://open.bigmodel.cn/*',
      'https://dashscope.aliyuncs.com/*',
      'https://ark.cn-beijing.volces.com/*',
      'https://api.x.ai/*',
      'https://api.siliconflow.cn/*',
      'http://localhost:11434/*',
      'http://127.0.0.1:11434/*',
    ],
    // captureVisibleTab only accepts the literal <all_urls> host permission
    // when the call is initiated from the in-page UI (which does not grant activeTab).
    host_permissions: ['<all_urls>'],
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      96: 'icon-96.png',
      128: 'icon-128.png',
    },
    action: {
      default_title: 'PageX',
      default_icon: {
        16: 'icon-16.png',
        32: 'icon-32.png',
        48: 'icon-48.png',
        96: 'icon-96.png',
        128: 'icon-128.png',
      },
    },
    options_ui: {
      open_in_tab: true,
    },
    commands: {
      'toggle-pagex': {
        suggested_key: { default: 'Alt+P' },
        description: '显示或隐藏 PageX',
      },
    },
  },
});
