import { describe, expect, it } from 'vitest'

/** 侧栏秒 ↔ 存储 ms（与 sidepanel w()/M 合同一致） */
export function secToMs(sec: number | '' | null | undefined): number | undefined {
  if (sec === '' || sec == null) return undefined
  const n = typeof sec === 'number' ? sec : Number(sec)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n * 1000)
}

export function msToSecDisplay(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return ''
  return String(Math.round(ms / 1000))
}

describe('policy interval sec/ms UI contract', () => {
  it('secToMs', () => {
    expect(secToMs(45)).toBe(45_000)
    expect(secToMs('')).toBeUndefined()
    expect(secToMs(0)).toBe(0)
  })
  it('msToSecDisplay', () => {
    expect(msToSecDisplay(45_000)).toBe('45')
    expect(msToSecDisplay(undefined)).toBe('')
  })
})
