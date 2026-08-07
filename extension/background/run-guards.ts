/**
 * 运行守卫：异常退避、content bridge 失联检测、登录/验证码 pause。
 */
import * as kv from '../data/kv'
import { appendEvent } from '../data/repos/events'
import {
  computeBackoffMs,
  requiresHumanIntervention,
} from '../domain/risk'
import { isStillRunning, stopRun } from './run-context'
import { sendToTabOnce } from './tab-runtime'

export function isContentBridgeDead(error?: string): boolean {
  if (!error) return false
  return (
    /Receiving end does not exist/i.test(error) ||
    /back\/forward cache/i.test(error) ||
    /message channel is closed/i.test(error) ||
    /Could not establish connection/i.test(error) ||
    /content script 无响应/i.test(error)
  )
}

/**
 * 记录异常并计算退避窗口。
 *
 * 连续异常会持续放大退避；已被风控盯上后立刻重试是最危险的行为，
 * 因此退避窗口会阻断 startRun，而不只是提示。
 */
export async function recordAnomaly(
  kind: import('../shared/types').AnomalyKind,
  reason: string,
): Promise<number> {
  const policy = await kv.getPolicy()
  const prev = await kv.getAnomaly()
  const consecutive = prev && prev.kind === kind ? prev.consecutive + 1 : 1
  const backoff = computeBackoffMs(policy, kind, consecutive)
  await kv.setAnomaly({
    kind,
    consecutive,
    until: Date.now() + backoff,
    needsHuman: requiresHumanIntervention(kind),
    reason,
  })
  return backoff
}

/** 动作成功→ 清除连续异常计数，否则退避会永久放大 */
export async function clearAnomalyOnSuccess(): Promise<void> {
  if (await kv.getAnomaly()) await kv.clearAnomaly()
}

/** detect_page.auth → auth_lost / captcha 事件 + stopRun；命中返回 true */
export async function detectAndPauseIfAuthLost(
  tabId: number,
  gen: number,
): Promise<boolean> {
  if (!(await isStillRunning(gen))) return true
  const det = await sendToTabOnce(tabId, { op: 'detect_page' })
  if (!det.ok) return false
  const data = det.data as
    | { auth?: string; href?: string; listTab?: string | null }
    | undefined
  const auth = data?.auth
  // unknown / ok / 缺省：不停。仅明确 login|captcha 才 pause（检测已改为保守）
  if (auth === 'login') {
    const backoff = await recordAnomaly('auth_lost', '登录失效')
    await appendEvent({
      type: 'auth_lost',
      payload: { auth, tabId, href: data?.href, backoffMs: backoff },
    })
    await stopRun(
      `登录失效（auth_lost）。请重新登录，并至少等 ${Math.ceil(backoff / 60000)} 分钟再开始`,
    )
    return true
  }
  if (auth === 'captcha') {
    const backoff = await recordAnomaly('captcha', '出现验证码')
    await appendEvent({
      type: 'captcha',
      payload: { auth, tabId, href: data?.href, backoffMs: backoff },
    })
    await stopRun(
      `检测到验证码（captcha）。请手动完成验证并正常浏览一会儿，` +
        `${Math.ceil(backoff / 60000)} 分钟内不会允许重新开始`,
    )
    return true
  }
  return false
}
