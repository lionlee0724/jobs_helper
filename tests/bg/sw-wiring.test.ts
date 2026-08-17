// Service Worker 接线守卫：防止 P0 级回归 —— 有人再次把 service-worker.ts
// "清瘦化" 成只 re-export 的 barrel（不注册任何监听），导致扩展整体哑火。
// 该守卫直接检查入口源码中必须存在的接线语句；缺任何一条即测试失败。
// 背景：2026-08-14 审计发现未提交重写删掉了全部事件接线（见
// docs/aegis/code-audit-2026-08-14.md P0-1）。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const swPath = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../extension/background/service-worker.ts',
)
const src = readFileSync(swPath, 'utf8')

describe('service-worker 接线守卫', () => {
  it('侧栏行为：openPanelOnActionClick 已注册', () => {
    expect(src).toMatch(/setPanelBehavior\(\{ openPanelOnActionClick: true \}\)|openPanelOnActionClick/)
  })

  it('安装/启动时确保 alarm 存活', () => {
    expect(src).toContain('chrome.runtime.onInstalled.addListener')
    expect(src).toContain('chrome.runtime.onStartup.addListener')
  })

  it('action.onClicked 兜底打开侧栏', () => {
    expect(src).toContain('chrome.action.onClicked.addListener')
  })

  it('alarm 分发已注册（tick 与消息循环），且没有 onAlarm 导出歧义', () => {
    expect(src).toContain('chrome.alarms.onAlarm.addListener')
    // 双 onAlarm 名字冲突会导致 tsc TS2308 直接失败，这里仅防御性强调消息循环入口仍在调用
    expect(src).toMatch(/message-assist-loop|msgAssistAlarm|assistantAlarm/)
  })

  it('工作标签关闭时暂停（tabs.onRemoved）', () => {
    expect(src).toContain('chrome.tabs.onRemoved.addListener')
  })

  it('消息路由已注册（runtime.onMessage）', () => {
    expect(src).toContain('chrome.runtime.onMessage.addListener')
  })
})