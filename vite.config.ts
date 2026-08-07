/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import path from 'path'
import { fileURLToPath } from 'url'
import manifest from './extension/manifest.config'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/** Chrome extension pages warn on modulepreload (cross-world). Strip any leftovers. */
function stripExtensionModulePreload(): Plugin {
  return {
    name: 'strip-extension-modulepreload',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset' || typeof item.source !== 'string') continue
        if (!item.fileName.endsWith('.html')) continue
        item.source = item.source.replace(
          /<link\s+rel=["']modulepreload["'][^>]*>\s*/gi,
          '',
        )
      }
    },
  }
}

export default defineConfig({
  // Chrome 扩展必须用相对路径；`/` 会让 sidepanel 去 chrome-extension://<id>/assets 之外解析失败
  base: './',
  plugins: [crx({ manifest }), stripExtensionModulePreload()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'extension'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Chrome extension pages treat modulepreload as cross-world and warn.
    // Entry script import still loads the real module graph.
    modulePreload: false,
  },
  test: {
    // 默认 node；DOM 适配层用文件头 `// @vitest-environment jsdom` 单独切换
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
