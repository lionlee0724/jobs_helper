import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'BOSS 求职副驾驶',
  description: '本地 Chrome 扩展：LLM 匹配 BOSS 职位、限速开聊与跟进、IndexedDB 统计',
  version: '0.2.0',
  permissions: ['storage', 'alarms', 'tabs', 'scripting', 'sidePanel'],
  // <all_urls> 覆盖 LLM 任意 baseURL；zhipin 显式写出便于审阅
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'extension/background/service-worker.ts',
    type: 'module',
  },
  action: {
    default_title: 'BOSS 求职副驾驶（点击打开侧栏）',
    default_icon: {
      '16': 'extension/icons/icon16.png',
      '32': 'extension/icons/icon32.png',
      '48': 'extension/icons/icon48.png',
      '128': 'extension/icons/icon128.png',
    },
  },
  icons: {
    '16': 'extension/icons/icon16.png',
    '32': 'extension/icons/icon32.png',
    '48': 'extension/icons/icon48.png',
    '128': 'extension/icons/icon128.png',
  },
  side_panel: {
    default_path: 'extension/ui/sidepanel/index.html',
  },
  // 本地数据看板（投递记录 / 统计），在新标签打开
  options_ui: {
    page: 'extension/ui/report/index.html',
    open_in_tab: true,
  },
  content_scripts: [
    {
      matches: ['*://*.zhipin.com/*', '*://*.bosszhipin.com/*'],
      js: ['extension/content/main.ts'],
      run_at: 'document_idle',
    },
  ],
})