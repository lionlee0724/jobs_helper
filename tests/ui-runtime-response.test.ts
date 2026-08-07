import { describe, expect, it } from 'vitest'
import {
  requireMessageResponse,
  requireOkResponse,
} from '../extension/ui/shared/runtime-response'

describe('requireOkResponse', () => {
  it('returns ok payload', () => {
    const r = requireOkResponse({ type: 'ok' })
    expect(r.type).toBe('ok')
  })

  it('throws on null/undefined (SW dead)', () => {
    expect(() => requireOkResponse(null)).toThrow(/无响应/)
    expect(() => requireOkResponse(undefined)).toThrow(/无响应/)
  })

  it('throws on type=error with message', () => {
    expect(() =>
      requireOkResponse({ type: 'error', error: '请先开启「启用自动执行」开关' }),
    ).toThrow('请先开启「启用自动执行」开关')
  })

  it('throws generic when error empty', () => {
    expect(() => requireOkResponse({ type: 'error' })).toThrow('操作失败')
  })
})

describe('requireMessageResponse', () => {
  it('allows type=error for callers that branch', () => {
    const r = requireMessageResponse({ type: 'error', error: 'x' })
    expect(r.type).toBe('error')
  })

  it('rejects null', () => {
    expect(() => requireMessageResponse(undefined)).toThrow(/无响应/)
  })
})
