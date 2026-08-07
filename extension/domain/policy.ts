import type { GuardResult, Policy } from '../shared/types'
import { effectivePolicy } from './risk'

/**
 * 限速门闩。
 *
 * 所有判定都基于**预设补齐后**的策略：用户选了风控档位即可启动，
 * 不必逐项手填；只有 custom 档才需要把必填项填完。
 */
export function canStart(rawPolicy: Policy): GuardResult {
  if (!rawPolicy.enabled) {
    return { ok: false, reason: '请先开启「启用自动执行」开关' }
  }
  const policy = effectivePolicy(rawPolicy)
  if (
    policy.dailyOpenChatLimit == null ||
    !Number.isFinite(policy.dailyOpenChatLimit) ||
    policy.dailyOpenChatLimit <= 0
  ) {
    return {
      ok: false,
      reason: '请填写有效的「日开聊上限」（正整数），或选一个风控档位',
    }
  }
  if (
    policy.minIntervalMs == null ||
    policy.maxIntervalMs == null ||
    !Number.isFinite(policy.minIntervalMs) ||
    !Number.isFinite(policy.maxIntervalMs)
  ) {
    return {
      ok: false,
      reason: '请填写开聊间隔（最小/最大毫秒），或选一个风控档位',
    }
  }
  if (policy.minIntervalMs < 0 || policy.maxIntervalMs < 0) {
    return { ok: false, reason: '间隔不能为负数' }
  }
  if (policy.minIntervalMs > policy.maxIntervalMs) {
    return { ok: false, reason: '最小间隔不能大于最大间隔' }
  }
  return { ok: true }
}

/** @deprecated 改用 domain/risk.ts 的 nextIntervalMs（含分布形状与长休） */
export function randomIntervalMs(rawPolicy: Policy): number {
  const policy = effectivePolicy(rawPolicy)
  const min = policy.minIntervalMs ?? 5000
  const max = policy.maxIntervalMs ?? 12000
  if (max <= min) return min
  return Math.floor(min + Math.random() * (max - min + 1))
}

export function canOpenMoreToday(
  rawPolicy: Policy,
  todayOpened: number,
): GuardResult {
  const limit = effectivePolicy(rawPolicy).dailyOpenChatLimit
  if (limit == null) return { ok: false, reason: '未配置日开聊上限' }
  if (todayOpened >= limit) {
    return { ok: false, reason: `已达日开聊上限 ${limit}` }
  }
  return { ok: true }
}

export function canReplyMoreToday(
  policy: Policy,
  todayReplies: number,
): GuardResult {
  if (policy.dailyReplyLimit == null) return { ok: true }
  if (todayReplies >= policy.dailyReplyLimit) {
    return { ok: false, reason: `已达日回复上限 ${policy.dailyReplyLimit}` }
  }
  return { ok: true }
}

/** 本轮 run 开聊硬顶；未配置 sessionMaxOpenChat 则不限制 */
export function canOpenMoreThisSession(
  policy: Policy,
  sessionOpened: number,
): GuardResult {
  const limit = policy.sessionMaxOpenChat
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return { ok: true }
  if (sessionOpened >= limit) {
    return { ok: false, reason: `已达本轮开聊上限 ${limit}` }
  }
  return { ok: true }
}

/** 本轮 run 自动回复硬顶；未配置 sessionMaxReplies 则不限制 */
export function canReplyMoreThisSession(
  policy: Policy,
  sessionReplies: number,
): GuardResult {
  const limit = policy.sessionMaxReplies
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return { ok: true }
  if (sessionReplies >= limit) {
    return { ok: false, reason: `已达本轮回复上限 ${limit}` }
  }
  return { ok: true }
}

/**
 * 职位线内环 B（跟进）是否开启。
 * 默认关闭：undefined/false → off；仅显式 true 开启。
 */
export function isFollowUpInJobRunEnabled(
  policy: Pick<Policy, 'followUpInJobRun'> | Policy,
): boolean {
  return policy.followUpInJobRun === true
}

/**
 * LLM 权重（0–1）。默认 0.75；关键词权重 = 1 - LLM权重。
 * 合同：可调区间 0.5–0.9，关键词封顶 60 保留。
 */
export function resolveMatchLlmWeight(policy: Pick<Policy, 'matchLlmWeight'> | Policy): number {
  const weight = policy.matchLlmWeight ?? 0.75;
  return Math.max(0.5, Math.min(0.9, weight));
}