// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  applyDocumentTheme,
  normalizeUiTheme,
  resolveUiTheme,
} from '../extension/ui/shared/theme'
import {
  matchReportShortcut,
  matchSidepanelShortcut,
  normalizeShortcutsEnabled,
} from '../extension/ui/shared/ui-shortcuts'

describe('theme', () => {
  it('normalizes unknown to dark default', () => {
    expect(normalizeUiTheme(undefined)).toBe('dark')
    expect(normalizeUiTheme('nope')).toBe('dark')
    expect(normalizeUiTheme('light')).toBe('light')
    expect(normalizeUiTheme('system')).toBe('system')
  })

  it('resolves system from flag', () => {
    expect(resolveUiTheme('system', true)).toBe('dark')
    expect(resolveUiTheme('system', false)).toBe('light')
    expect(resolveUiTheme('light', true)).toBe('light')
    expect(resolveUiTheme('dark', false)).toBe('dark')
  })

  it('applies data-theme on element', () => {
    const el = document.createElement('div')
    expect(applyDocumentTheme('light', el)).toBe('light')
    expect(el.dataset.theme).toBe('light')
    expect(el.style.colorScheme).toBe('light')
    expect(applyDocumentTheme('dark', el)).toBe('dark')
    expect(el.dataset.theme).toBe('dark')
  })
})

describe('shortcuts', () => {
  it('defaults shortcuts enabled', () => {
    expect(normalizeShortcutsEnabled(undefined)).toBe(true)
    expect(normalizeShortcutsEnabled(false)).toBe(false)
  })

  it('matches sidepanel Alt+tabs and save/export/refresh', () => {
    expect(
      matchSidepanelShortcut({
        key: '1',
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('tab-run')
    expect(
      matchSidepanelShortcut({
        key: '3',
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('tab-policy')
    expect(
      matchSidepanelShortcut({
        key: 's',
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('save-policy')
    expect(
      matchSidepanelShortcut({
        key: 'C',
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe('export-csv')
    expect(
      matchSidepanelShortcut({
        key: 'r',
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('refresh')
  })

  it('does not match bare keys without modifiers', () => {
    expect(
      matchSidepanelShortcut({
        key: '1',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBeNull()
    expect(
      matchSidepanelShortcut({
        key: 's',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBeNull()
  })

  it('matches report shortcuts', () => {
    expect(
      matchReportShortcut({
        key: 'c',
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe('export-csv')
    expect(
      matchReportShortcut({
        key: 'r',
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('refresh')
  })
})
