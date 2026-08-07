/**
 * 扩展页（侧栏/报告）快捷键匹配。
 * 只覆盖扩展 UI 已有动作；不注入 BOSS 内容页，避免抢页面焦点。
 */

export type SidepanelShortcutAction =
  | 'tab-run'
  | 'tab-msg'
  | 'tab-policy'
  | 'tab-setup'
  | 'save-policy'
  | 'export-csv'
  | 'refresh'

export type ReportShortcutAction = 'export-csv' | 'refresh'

export type ShortcutKeyEvent = {
  key: string
  code?: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** 默认开启；用户可在设置关闭 */
export const DEFAULT_SHORTCUTS_ENABLED = true

export function normalizeShortcutsEnabled(v: unknown): boolean {
  if (v === false) return false
  if (v === true) return true
  return DEFAULT_SHORTCUTS_ENABLED
}

function mod(e: ShortcutKeyEvent): boolean {
  return e.ctrlKey || e.metaKey
}

function digit(e: ShortcutKeyEvent): string | null {
  const k = e.key
  if (k >= '1' && k <= '4') return k
  // 部分布局用 code
  if (e.code === 'Digit1' || e.code === 'Numpad1') return '1'
  if (e.code === 'Digit2' || e.code === 'Numpad2') return '2'
  if (e.code === 'Digit3' || e.code === 'Numpad3') return '3'
  if (e.code === 'Digit4' || e.code === 'Numpad4') return '4'
  return null
}

/**
 * 侧栏快捷键（输入框聚焦时由调用方跳过）：
 * - Alt+1..4：运行 / 消息 / 策略 / 设置
 * - Ctrl/Cmd+S：保存策略
 * - Ctrl/Cmd+Shift+C：导出 CSV
 * - Alt+R：刷新状态（避开浏览器 Ctrl+R 整页重载）
 */
export function matchSidepanelShortcut(
  e: ShortcutKeyEvent,
): SidepanelShortcutAction | null {
  const d = digit(e)
  if (e.altKey && !mod(e) && !e.shiftKey && d) {
    if (d === '1') return 'tab-run'
    if (d === '2') return 'tab-msg'
    if (d === '3') return 'tab-policy'
    if (d === '4') return 'tab-setup'
  }

  if (mod(e) && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
    return 'save-policy'
  }

  if (mod(e) && e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
    return 'export-csv'
  }

  if (e.altKey && !mod(e) && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
    return 'refresh'
  }

  return null
}

/**
 * 报告页快捷键：
 * - Ctrl/Cmd+Shift+C：导出 CSV
 * - Alt+R：刷新
 */
export function matchReportShortcut(e: ShortcutKeyEvent): ReportShortcutAction | null {
  if (mod(e) && e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
    return 'export-csv'
  }
  if (e.altKey && !mod(e) && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
    return 'refresh'
  }
  return null
}
