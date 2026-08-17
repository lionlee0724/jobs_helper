/**
 * 风控策略 — 纯函数，无 chrome.* / 无 DOM。
 *
 * 设计取向：默认保守档。限速只是最表层的手段，真正影响存活的是
 * ①投递总量与节奏 ②时段分布 ③单次动作的时间形态 ④出现异常后是否立刻收敛。
 * 本模块负责 ①②④ 的判定；③ 的执行在 content 适配层。
 */

import type {
  AnomalyKind,
  GuardResult,
  HumanizeLevel,
  Policy,
  RiskProfile,
} from '../shared/types'

export type RiskPreset = Required<
  Pick<
    Policy,
    | 'dailyOpenChatLimit'
    | 'hourlyOpenChatLimit'
    | 'minIntervalMs'
    | 'maxIntervalMs'
    | 'humanize'
    | 'backoffBaseMs'
    | 'backoffMaxMs'
  >
> & { activeWeekdays?: number[] }

/**
 * 三档预设。
 *
 * conservative 的取值依据：单账号人工投递日均通常在 20-40 之间，
 * 30 落在人类可解释区间内；间隔 45-150s 使小时产出约 24-80，配合
 * 小时上限 6 强制拉平节奏，避免「开头猛投一小时」这种最易触发的形态。
 */
const PRESETS: Record<Exclude<RiskProfile, 'custom'>, RiskPreset> = {
  conservative: {
    dailyOpenChatLimit: 30,
    hourlyOpenChatLimit: 6,
    minIntervalMs: 45_000,
    maxIntervalMs: 150_000,
    // 时段限制已整体移除（2026-08-14，随时可测）：不再锁定小时/星期
    humanize: 'strong',
    backoffBaseMs: 15 * 60_000,
    backoffMaxMs: 4 * 60 * 60_000,
  },
  balanced: {
    dailyOpenChatLimit: 60,
    hourlyOpenChatLimit: 12,
    minIntervalMs: 20_000,
    maxIntervalMs: 75_000,
    activeWeekdays: undefined,
    humanize: 'light',
    backoffBaseMs: 5 * 60_000,
    backoffMaxMs: 60 * 60_000,
  },
  aggressive: {
    dailyOpenChatLimit: 150,
    hourlyOpenChatLimit: 30,
    minIntervalMs: 6_000,
    maxIntervalMs: 20_000,
    activeWeekdays: undefined,
    humanize: 'off',
    backoffBaseMs: 60_000,
    backoffMaxMs: 15 * 60_000,
  },
}

export function riskPresetOf(profile: RiskProfile | undefined): RiskPreset | null {
  if (!profile || profile === 'custom') return null
  return PRESETS[profile]
}

/**
 * 把预设与用户显式配置合并。
 * 用户显式填写的值永远覆盖预设（预设只补空缺）。
 */
export function effectivePolicy(policy: Policy): Policy {
  const preset = riskPresetOf(policy.riskProfile ?? 'conservative')
  if (!preset) return policy
  const merged: Policy = { ...policy }
  for (const [k, v] of Object.entries(preset) as Array<[keyof Policy, unknown]>) {
    if (merged[k] == null && v != null) {
      ;(merged as Record<string, unknown>)[k] = v
    }
  }
  return merged
}

// —— 小时配额 ——

export function canOpenMoreThisHour(
  policy: Policy,
  hourOpened: number,
): GuardResult {
  const limit = effectivePolicy(policy).hourlyOpenChatLimit
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return { ok: true }
  if (hourOpened >= limit) {
    return { ok: false, reason: `已达小时开聊上限 ${limit}` }
  }
  return { ok: true }
}

// —— 节奏 ——

/**
 * 下一次动作前的等待。
 *
 * 均匀随机在统计上是可识别的机器特征。这里叠加两点：
 * 1. 对数偏置 —— 短间隔更常见、长间隔偶发，接近人的操作分布
 * 2. 长休概率 —— 每若干次动作插入一次显著更长的停顿（去倒水/看别处）
 */
export function nextIntervalMs(
  policy: Policy,
  opts: { rand?: () => number } = {},
): number {
  const p = effectivePolicy(policy)
  const rand = opts.rand ?? Math.random
  const min = p.minIntervalMs ?? 45_000
  const max = p.maxIntervalMs ?? 150_000
  if (max <= min) return min

  const humanize = p.humanize ?? 'strong'
  if (humanize === 'off') {
    return Math.floor(min + rand() * (max - min + 1))
  }

  // 对数偏置：r^2 使分布向 min 侧聚集
  const r = rand()
  const biased = r * r
  let ms = min + biased * (max - min)

  // 长休：strong 档约 12% 概率，额外拉长 1.5-3 倍
  const longPauseChance = humanize === 'strong' ? 0.12 : 0.05
  if (rand() < longPauseChance) {
    ms *= 1.5 + rand() * 1.5
  }
  return Math.floor(ms)
}

// —— 异常退避 ——

/** 异常严重度：决定退避倍率与是否需要人工介入 */
export function anomalySeverity(kind: AnomalyKind): number {
  switch (kind) {
    case 'captcha':
      return 4
    case 'auth_lost':
      return 4
    case 'rate_hint':
      return 3
    case 'content_dead':
      return 2
    case 'action_failed':
      return 1
  }
}

/** 该异常是否必须人工介入（不可自动恢复） */
export function requiresHumanIntervention(kind: AnomalyKind): boolean {
  return kind === 'captcha' || kind === 'auth_lost'
}

/**
 * 指数退避。
 *
 * 连续异常次数越多等得越久，上限封顶；叠加 ±20% 抖动避免固定周期重试
 * 本身成为特征。
 */
export function computeBackoffMs(
  policy: Policy,
  kind: AnomalyKind,
  consecutive: number,
  opts: { rand?: () => number } = {},
): number {
  const p = effectivePolicy(policy)
  const rand = opts.rand ?? Math.random
  const base = p.backoffBaseMs ?? 15 * 60_000
  const cap = p.backoffMaxMs ?? 4 * 60 * 60_000

  const n = Math.max(1, Math.floor(consecutive))
  const severity = anomalySeverity(kind)
  const raw = base * severity * Math.pow(2, n - 1)
  const capped = Math.min(raw, cap)
  const jitter = 0.8 + rand() * 0.4
  return Math.floor(capped * jitter)
}

// —— 行为拟真参数 ——

export type HumanTiming = {
  /** 打开详情后的阅读停留 */
  readDwellMs: [number, number]
  /** 点击前的犹豫 */
  preClickMs: [number, number]
  /** 逐字输入间隔；[0,0] 表示整段直接写入 */
  typingCharMs: [number, number]
  /** 发送前的检查停顿 */
  preSendMs: [number, number]
  /** 是否模拟滚动阅读 */
  scroll: boolean
}

export function humanTiming(policy: Policy): HumanTiming {
  const level: HumanizeLevel = effectivePolicy(policy).humanize ?? 'strong'
  if (level === 'off') {
    return {
      readDwellMs: [0, 0],
      preClickMs: [0, 0],
      typingCharMs: [0, 0],
      preSendMs: [0, 0],
      scroll: false,
    }
  }
  if (level === 'light') {
    return {
      readDwellMs: [1200, 3500],
      preClickMs: [200, 700],
      typingCharMs: [0, 0],
      preSendMs: [400, 1200],
      scroll: false,
    }
  }
  return {
    readDwellMs: [3000, 9000],
    preClickMs: [400, 1600],
    typingCharMs: [40, 160],
    preSendMs: [900, 2600],
    scroll: true,
  }
}

export function pickInRange(
  range: [number, number],
  rand: () => number = Math.random,
): number {
  const [lo, hi] = range
  if (hi <= lo) return lo
  return Math.floor(lo + rand() * (hi - lo))
}
