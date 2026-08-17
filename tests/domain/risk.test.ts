import { describe, it, expect } from 'vitest'
import {
  effectivePolicy,
  isWithinActiveWindow,
  msUntilActiveWindow,
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
    expect(p.activeHourStart).toBe(9)
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

describe('isWithinActiveWindow', () => {
  // 2026-07-22 是周三
  const wed = (h: number) => new Date(2026, 6, 22, h, 0, 0)
  const sat = (h: number) => new Date(2026, 6, 25, h, 0, 0)

  it('保守档：工作日 9-20 点内允许', () => {
    expect(isWithinActiveWindow(conservative, wed(9)).ok).toBe(true)
    expect(isWithinActiveWindow(conservative, wed(19)).ok).toBe(true)
  })

  it('保守档：时段外拒绝', () => {
    expect(isWithinActiveWindow(conservative, wed(8)).ok).toBe(false)
    expect(isWithinActiveWindow(conservative, wed(20)).ok).toBe(false)
    expect(isWithinActiveWindow(conservative, wed(3)).ok).toBe(false)
  })

  it('保守档：周末不再锁定（时段内允许，08-08 PRD）', () => {
    const r = isWithinActiveWindow(conservative, sat(10))
    expect(r.ok).toBe(true)
  })

  it('跨零点窗口按环绕处理', () => {
    const night: Policy = {
      enabled: true,
      riskProfile: 'custom',
      activeHourStart: 22,
      activeHourEnd: 6,
    }
    expect(isWithinActiveWindow(night, wed(23)).ok).toBe(true)
    expect(isWithinActiveWindow(night, wed(2)).ok).toBe(true)
    expect(isWithinActiveWindow(night, wed(12)).ok).toBe(false)
  })

  it('aggressive 档 0-24 视为不限', () => {
    const p: Policy = { enabled: true, riskProfile: 'aggressive' }
    expect(isWithinActiveWindow(p, wed(3)).ok).toBe(true)
    expect(isWithinActiveWindow(p, sat(3)).ok).toBe(true)
  })
})

describe('msUntilActiveWindow', () => {
  it('窗口内返回 0', () => {
    expect(msUntilActiveWindow(conservative, new Date(2026, 6, 22, 10))).toBe(0)
  })

  it('清晨等待到当日 9 点', () => {
    const ms = msUntilActiveWindow(conservative, new Date(2026, 6, 22, 7, 0, 0))
    expect(ms).toBe(2 * 60 * 60 * 1000)
  })

  it('周五夜间到周六上午（周末锁已移除）', () => {
    // 2026-07-24 周五 21:00 → 下一个允许时刻是周六 9:00（仅受时段限制）
    const from = new Date(2026, 6, 24, 21, 0, 0)
    const ms = msUntilActiveWindow(conservative, from)
    const target = new Date(from.getTime() + ms)
    expect(target.getDay()).toBe(6)
    expect(target.getHours()).toBe(9)
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
