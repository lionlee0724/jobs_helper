/**
 * 消息处理循环 —— 「点一次跑到队列清空」的控制器。
 *
 * 为什么不用 while 循环：MV3 的 Service Worker 会在空闲时被回收，
 * 一个跨越数分钟、中间还要按限速等待的长循环必然被打断。
 * 因此改为 **alarm 驱动的持久化状态机**：每次只处理一条，处理完把下一次
 * 唤醒时间写进 alarm，SW 被回收也能继续。
 *
 * 职责边界：
 * - 本模块只管「还要不要继续、什么时候继续、进度是多少」
 * - 单条会话的实际处理仍复用 scheduler.runMessageAssist（唯一处理逻辑 owner）
 */

import * as kv from '../data/kv'
import * as threadsRepo from '../data/repos/chat-threads'
import { appendEvent } from '../data/repos/events'
import { nextIntervalMs } from '../domain/risk'
import {
  scoreChatSessionMatch,
  CHAT_MATCH_THRESHOLD,
} from '../domain/chat-match'
import { runMessageAssist, scanChatSessions } from './scheduler'

export const ALARM_MSG_ASSIST = 'boss-msg-assist'

/**
 * Chrome 对 alarm 的最小延迟有下限（MV3 下短于约 30s 会被抬高），
 * 因此这里显式取 35s 保底，避免「设了 5s 实际 30s」造成进度预估失真。
 */
const MIN_ALARM_DELAY_MS = 35_000

const KEY = 'msgAssistLoop'

export type LoopState = {
  active: boolean
  processed: number
  startedAt: number
  lastAction?: string
  lastError?: string
  stoppedReason?: string
}

const IDLE: LoopState = { active: false, processed: 0, startedAt: 0 }

async function getState(): Promise<LoopState> {
  const r = await chrome.storage.local.get(KEY)
  return (r[KEY] as LoopState | undefined) ?? IDLE
}

async function setState(patch: Partial<LoopState>): Promise<LoopState> {
  const cur = await getState()
  const next = { ...cur, ...patch }
  await chrome.storage.local.set({ [KEY]: next })
  return next
}

/** 队列里还有多少条待跟进 */
export async function remainingCount(): Promise<number> {
  const rows = await threadsRepo.listFollowableThreads()
  return rows.length
}

export async function getProgress(): Promise<{
  active: boolean
  processed: number
  remaining: number
  lastAction?: string
  lastError?: string
  stoppedReason?: string
}> {
  const s = await getState()
  return {
    active: s.active,
    processed: s.processed,
    remaining: await remainingCount(),
    lastAction: s.lastAction,
    lastError: s.lastError,
    stoppedReason: s.stoppedReason,
  }
}

export async function stopAll(reason = '用户停止'): Promise<void> {
  await chrome.alarms.clear(ALARM_MSG_ASSIST)
  await setState({ active: false, stoppedReason: reason })
}

/**
 * 启动循环。
 *
 * 立即跑第一条（用户点了按钮就该有反馈），之后交给 alarm 续跑。
 */
export async function startAll(): Promise<{ ok: boolean; error?: string }> {
  const remaining = await remainingCount()
  if (remaining === 0) {
    return { ok: false, error: '当前没有待跟进的会话。可先点「导入现有会话」' }
  }

  // 先刷新未读，让有新消息的会话排到前面（不导入新会话，导入仍是显式操作）
  await refreshUnreadFlags().catch(() => undefined)

  await setState({
    active: true,
    processed: 0,
    startedAt: Date.now(),
    lastError: undefined,
    stoppedReason: undefined,
    lastAction: undefined,
  })
  await appendEvent({ type: 'run_start', payload: { scope: 'message_assist', remaining } })
  void pump()
  return { ok: true }
}

/** 安排下一次唤醒 */
async function scheduleNext(): Promise<void> {
  const policy = await kv.getPolicy()
  const delay = Math.max(MIN_ALARM_DELAY_MS, nextIntervalMs(policy))
  await chrome.alarms.create(ALARM_MSG_ASSIST, { when: Date.now() + delay })
}

/**
 * 处理一条，然后决定是否继续。
 *
 * 每一步都重新读状态：用户可能在等待期间点了停止。
 */
export async function pump(): Promise<void> {
  const s = await getState()
  if (!s.active) return

  let r: Awaited<ReturnType<typeof runMessageAssist>>
  try {
    r = await runMessageAssist({ limit: 1 })
  } catch (e) {
    await setState({ lastError: e instanceof Error ? e.message : String(e) })
    await stopAll('处理出错已停止')
    return
  }

  // 再读一次：处理期间可能被停止
  if (!(await getState()).active) return

  if (!r.ok) {
    await setState({ lastError: r.error })
    await stopAll(r.error || '处理失败已停止')
    return
  }

  if (r.processed === 0) {
    await stopAll('队列已清空')
    return
  }

  const last = r.results[r.results.length - 1]
  await setState({
    processed: (await getState()).processed + r.processed,
    lastAction: last ? `${last.company || ''} ${last.jobTitle || ''} → ${last.action}`.trim() : undefined,
  })

  if ((await remainingCount()) === 0) {
    await stopAll('队列已清空')
    return
  }

  await scheduleNext()
}

/**
 * 刷新已登记会话的未读标记。
 *
 * **不导入新会话** —— 导入是显式操作，不能因为启动循环就静默把
 * 消息列表里所有陌生会话拉进来。
 */
export async function refreshUnreadFlags(): Promise<{ marked: number }> {
  const scan = await scanChatSessions()
  if (!scan.ok) return { marked: 0 }

  const unreadSessions = scan.sessions.filter((s) => s.unread)
  if (!unreadSessions.length) return { marked: 0 }

  const threads = await threadsRepo.listFollowableThreads()
  let marked = 0
  for (const t of threads) {
    const best = unreadSessions.reduce(
      (acc, s) => {
        const score = scoreChatSessionMatch(
          { company: t.company, jobTitle: t.jobTitle, jobId: t.jobId },
          s,
        )
        return score > acc.score ? { score, s } : acc
      },
      { score: -1, s: unreadSessions[0] },
    )
    if (best.score >= CHAT_MATCH_THRESHOLD) {
      await threadsRepo.markUnreadSeen(t.id)
      marked++
    }
  }
  return { marked }
}

export async function onAlarm(name: string): Promise<void> {
  if (name !== ALARM_MSG_ASSIST) return
  await pump()
}

/**
 * 从消息列表导入尚未登记的会话。
 *
 * 导入的会话没有职位上下文（source='imported'），回复时提示词会更保守。
 */
export async function importExistingThreads(): Promise<{
  ok: boolean
  error?: string
  scanned: number
  imported: number
  updated: number
  skipped: number
}> {
  const scan = await scanChatSessions()
  if (!scan.ok) {
    return { ok: false, error: scan.error, scanned: 0, imported: 0, updated: 0, skipped: 0 }
  }
  const items = scan.sessions
    .filter((s) => s.title && s.title.length >= 2)
    .map((s) => ({
      key: s.key,
      title: s.title,
      company: s.company,
      unread: s.unread,
    }))

  const r = await threadsRepo.importThreads(items)
  await appendEvent({
    type: 'tick',
    payload: { scope: 'threads_import', scanned: items.length, ...r },
  })
  return { ok: true, scanned: items.length, ...r }
}
