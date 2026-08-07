import { describe, expect, it } from 'vitest'
import {
  canStart,
  canOpenMoreToday,
  canOpenMoreThisSession,
  canReplyMoreThisSession,
  isFollowUpInJobRunEnabled,
  randomIntervalMs,
} from '../../extension/domain/policy'

describe('canStart', () => {
  it('rejects when disabled', () => {
    const r = canStart({ enabled: false, dailyOpenChatLimit: 10, minIntervalMs: 1, maxIntervalMs: 2 })
    expect(r.ok).toBe(false)
  })

  // 不变量：绝不在「无明确日上限」时启动。
  // 2026-07 风控档位上线后，上限可由预设提供；仅 custom 档需要手填。
  it('rejects missing daily limit under custom profile', () => {
    const r = canStart({
      enabled: true,
      riskProfile: 'custom',
      minIntervalMs: 1000,
      maxIntervalMs: 2000,
    })
    expect(r.ok).toBe(false)
  })

  it('accepts preset-supplied limit when fields left blank', () => {
    const r = canStart({ enabled: true, riskProfile: 'conservative' })
    expect(r).toEqual({ ok: true })
  })

  it('custom profile with no limits at all is rejected', () => {
    const r = canStart({ enabled: true, riskProfile: 'custom' })
    expect(r.ok).toBe(false)
  })

  it('rejects min > max', () => {
    const r = canStart({
      enabled: true,
      riskProfile: 'custom',
      dailyOpenChatLimit: 5,
      minIntervalMs: 5000,
      maxIntervalMs: 1000,
    })
    expect(r.ok).toBe(false)
  })

  it('accepts complete policy', () => {
    const r = canStart({
      enabled: true,
      dailyOpenChatLimit: 30,
      minIntervalMs: 5000,
      maxIntervalMs: 12000,
    })
    expect(r).toEqual({ ok: true })
  })
})

describe('canOpenMoreToday', () => {
  it('blocks at cap', () => {
    const r = canOpenMoreToday({ enabled: true, dailyOpenChatLimit: 2 }, 2)
    expect(r.ok).toBe(false)
  })
})

describe('randomIntervalMs', () => {
  it('stays in range', () => {
    const policy = { enabled: true, minIntervalMs: 100, maxIntervalMs: 200 }
    for (let i = 0; i < 20; i++) {
      const n = randomIntervalMs(policy)
      expect(n).toBeGreaterThanOrEqual(100)
      expect(n).toBeLessThanOrEqual(200)
    }
  })
})

describe('canOpenMoreThisSession', () => {
  it('allows when session max unset', () => {
    const r = canOpenMoreThisSession({ enabled: true }, 99)
    expect(r).toEqual({ ok: true })
  })

  it('blocks at session cap', () => {
    const r = canOpenMoreThisSession({ enabled: true, sessionMaxOpenChat: 3 }, 3)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('本轮开聊上限')
  })

  it('allows under session cap', () => {
    const r = canOpenMoreThisSession({ enabled: true, sessionMaxOpenChat: 3 }, 2)
    expect(r).toEqual({ ok: true })
  })
})

describe('canReplyMoreThisSession', () => {
  it('allows when unset', () => {
    expect(canReplyMoreThisSession({ enabled: true }, 10)).toEqual({ ok: true })
  })

  it('blocks at session reply cap', () => {
    const r = canReplyMoreThisSession({ enabled: true, sessionMaxReplies: 3 }, 3)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('本轮回复上限')
  })
})