/** 侧栏 / 报告页主题：CSS 变量切换，偏好写入 Policy 持久化 */

export type UiThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

/** 现有 UI 默认深色，保持兼容 */
export const DEFAULT_UI_THEME: UiThemePreference = 'dark'

export function normalizeUiTheme(v: unknown): UiThemePreference {
  if (v === 'light' || v === 'dark' || v === 'system') return v
  return DEFAULT_UI_THEME
}

export function systemPrefersDark(
  mql?: Pick<MediaQueryList, 'matches'> | null,
): boolean {
  if (mql) return Boolean(mql.matches)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

export function resolveUiTheme(
  pref: UiThemePreference | unknown,
  systemDark?: boolean,
): ResolvedTheme {
  const p = normalizeUiTheme(pref)
  if (p === 'light') return 'light'
  if (p === 'dark') return 'dark'
  return (systemDark ?? systemPrefersDark()) ? 'dark' : 'light'
}

/**
 * 把解析后的主题写到 documentElement（data-theme + color-scheme）。
 * 不碰匹配/风控逻辑。
 */
export function applyDocumentTheme(
  pref: UiThemePreference | unknown,
  root: HTMLElement = document.documentElement,
  systemDark?: boolean,
): ResolvedTheme {
  const resolved = resolveUiTheme(pref, systemDark)
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  return resolved
}
