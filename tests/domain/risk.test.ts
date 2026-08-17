import { describe, it, expect } from 'vitest'
import {
  effectivePolicy,
  canOpenMoreThisHour,
  nextIntervalMs,
  computeBackoffMs,
  requiresHumanIntervention,
  humanTiming,
  riskPresetOf,
} from '../../extension/domain/risk'
import type { Policy } from '../../extension/shared/types'

const conservative: Policy = { enabled: true, riskProfile: 'conservative' }

/** 固定序列的伪随机，便于断言分布行为 */
function seq(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('effectivePolicy — 预设补空缺，不覆盖用户显式值', () => {
  it('保守档补齐默认值', () => {
    const p = effectivePolicy(conservative)
    expect(p.dailyOpenChatLimit).toBe(30)
    expect(p.hourlyOpenChatLimit).toBe(6)
    expect(p.humanize).toBe('strong')
  })

  it('用户显式值优先于预设', () => {
    const p = effectivePolicy({ ...conservative, dailyOpenChatLimit: 5 })
    expect(p.dailyOpenChatLimit).toBe(5)
    // 未填的仍由预设补齐
    expect(p.hourlyOpenChatLimit).toBe(6)
  })

  it('custom 档不注入任何预设', () => {
    expect(riskPresetOf('custom')).toBeNull()
    const p = effectivePolicy({ enabled: true, riskProfile: 'custom' })
    expect(p.dailyOpenChatLimit).toBeUndefined()
  })
})

describe('canOpenMoreThisHour', () => {
  it('未达上限放行', () => {
    expect(canOpenMoreThisHour(conservative, 5).ok).toBe(true)
  })
  it('达到上限拦截', () => {
    const r = canOpenMoreThisHour(conservative, 6)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('6')
  })
  it('未配置则不限制', () => {
    const p: Policy = { enabled: true, riskProfile: 'custom' }
    expect(canOpenMoreThisHour(p, 999).ok).toBe(true)
  })
})

describe('nextIntervalMs', () => {
  it('落在 [min, max] 且受长休放大后仍为正', () => {
    for (let i = 0; i < 200; i++) {
      const ms = nextIntervalMs(conservative)
      expect(ms).toBeGreaterThanOrEqual(45_000)
      expect(ms).toBeGreaterThan(0)
    }
  })

  it('humanize=off 时为均匀分布，不放大', () => {
    const p: Policy = { enabled: true, riskProfile: 'aggressive' }
    const ms = nextIntervalMs(p, { rand: seq([0.5]) })
    expect(ms).toBe(Math.floor(6_000 + 0.5 * (20_000 - 6_000 + 1)))
  })

  it('对数偏置使中位随机值落在区间前段', () => {
    // rand=0.5 → biased=0.25 → 明显靠近 min
    const ms = nextIntervalMs(conservative, { rand: seq([0.5, 0.99]) })
    const span = 150_000 - 45_000
    expect(ms).toBe(Math.floor(45_000 + 0.25 * span))
  })

  it('命中长休概率时显著拉长', () => {
    // 第二个随机数 0.01 < 0.12 → 触发长休
    const ms = nextIntervalMs(conservative, { rand: seq([0.5, 0.01, 0.5]) })
    expect(ms).toBeGreaterThan(45_000 + 0.25 * (150_000 - 45_000))
  })
})

describe('computeBackoffMs', () => {
  const noJitter = () => 0.5 // → 系数 1.0

  it('随连续次数指数增长', () => {
    const a = computeBackoffMs(conservative, 'action_failed', 1, { rand: noJitter })
    const b = computeBackoffMs(conservative, 'action_failed', 2, { rand: noJitter })
    const c = computeBackoffMs(conservative, 'action_failed', 3, { rand: noJitter })
    expect(b).toBe(a * 2)
    expect(c).toBe(a * 4)
  })

  it('严重异常退避更久', () => {
    const light = computeBackoffMs(conservative, 'action_failed', 1, { rand: noJitter })
    const heavy = computeBackoffMs(conservative, 'captcha', 1, { rand: noJitter })
    expect(heavy).toBeGreaterThan(light)
  })

  it('封顶不超过 backoffMaxMs', () => {
    const ms = computeBackoffMs(conservative, 'captcha', 20, { rand: () => 1 })
    expect(ms).toBeLessThanOrEqual(4 * 60 * 60_000 * 1.2)
  })

  it('抖动使同参数结果不恒等', () => {
    const a = computeBackoffMs(conservative, 'rate_hint', 2, { rand: () => 0 })
    const b = computeBackoffMs(conservative, 'rate_hint', 2, { rand: () => 1 })
    expect(a).not.toBe(b)
  })
})

describe('requiresHumanIntervention', () => {
  it('验证码与掉登录需人工', () => {
    expect(requiresHumanIntervention('captcha')).toBe(true)
    expect(requiresHumanIntervention('auth_lost')).toBe(true)
  })
  it('一般失败可自动退避重试', () => {
    expect(requiresHumanIntervention('action_failed')).toBe(false)
    expect(requiresHumanIntervention('rate_hint')).toBe(false)
  })
})

describe('humanTiming', () => {
  it('strong 档启用逐字输入与滚动', () => {
    const t = humanTiming(conservative)
    expect(t.typingCharMs[1]).toBeGreaterThan(0)
    expect(t.scroll).toBe(true)
  })
  it('off 档全部为 0', () => {
    const t = humanTiming({ enabled: true, riskProfile: 'aggressive' })
    expect(t.readDwellMs).toEqual([0, 0])
    expect(t.scroll).toBe(false)
  })
})
