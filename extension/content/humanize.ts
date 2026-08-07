/**
 * 行为拟真执行层。
 *
 * 只负责「按给定时间形态执行动作」，不做任何策略判断——区间由 SW 依据
 * Policy 算好后下发（domain/risk.ts:humanTiming）。
 *
 * 为什么需要：仅靠请求间隔随机化不足以掩盖自动化特征。真实用户打开职位后
 * 会有阅读停留与滚动，输入是逐字而非整段瞬时出现，发送前还有短暂停顿。
 * 这些时间形态比单纯的间隔更难伪造，也更容易被用来区分脚本。
 */

import type { ActionTiming } from '../shared/types'

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)))
}

export function randIn(range?: [number, number]): number {
  if (!range) return 0
  const [lo, hi] = range
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0
  if (hi <= lo) return Math.max(0, lo)
  return Math.floor(lo + Math.random() * (hi - lo))
}

export async function waitIn(range?: [number, number]): Promise<void> {
  const ms = randIn(range)
  if (ms > 0) await sleep(ms)
}

/**
 * 模拟阅读：分几段向下滚动并停留，最后回到可操作位置。
 *
 * 用 scrollBy 的平滑滚动而非瞬时 scrollTo，避免出现「瞬间到底」这种
 * 人类不会产生的轨迹。
 */
export async function simulateReading(timing?: ActionTiming): Promise<void> {
  if (!timing) return
  const total = randIn(timing.readDwellMs)
  if (total <= 0) return

  if (!timing.scroll) {
    await sleep(total)
    return
  }

  const steps = 2 + Math.floor(Math.random() * 3)
  const per = Math.floor(total / (steps + 1))
  for (let i = 0; i < steps; i++) {
    try {
      const dy = 120 + Math.floor(Math.random() * 320)
      window.scrollBy({ top: dy, behavior: 'smooth' })
    } catch {
      /* 某些页面禁用平滑滚动，忽略 */
    }
    await sleep(per + Math.floor(Math.random() * 200))
  }
  // 往回带一点：人读完常会上滑确认
  try {
    window.scrollBy({ top: -(60 + Math.floor(Math.random() * 160)), behavior: 'smooth' })
  } catch {
    /* ignore */
  }
  await sleep(per)
}
