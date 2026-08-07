/** 当前右侧会话 → 库内 thread 解析（纯逻辑，可单测） */

import type { ChatThread } from '../shared/types'
import {
  CHAT_MATCH_THRESHOLD,
  scoreChatSessionMatch,
} from './chat-match'

export type ActiveChatContext = {
  title?: string
  company?: string
  blob: string
}

/**
 * 对已有 thread 与当前 UI 上下文打分。
 * 双向打分取较高分：thread 当 target / context 当 target。
 */
export function scoreThreadAgainstActiveContext(
  ctx: ActiveChatContext,
  thread: ChatThread,
): number {
  const ctxTitle = (ctx.title || '').trim()
  const ctxCompany = (ctx.company || '').trim()
  const threadTitle = (thread.jobTitle || '').trim()
  const threadCompany = (thread.company || '').trim()

  const forward = scoreChatSessionMatch(
    { company: threadCompany || undefined, jobTitle: threadTitle || undefined },
    {
      key: thread.id,
      title: ctxTitle || ctx.blob.slice(0, 60),
      company: ctxCompany || undefined,
      preview: ctx.blob,
    },
  )
  const reverse = scoreChatSessionMatch(
    { company: ctxCompany || undefined, jobTitle: ctxTitle || undefined },
    {
      key: thread.id,
      title: threadTitle || '',
      company: threadCompany || undefined,
      preview: [threadTitle, threadCompany].filter(Boolean).join(' '),
    },
  )
  return Math.max(forward, reverse)
}

/**
 * 在已有 threads 中找最佳匹配；低于阈值返回 null。
 */
export function pickBestThreadForActiveContext(
  ctx: ActiveChatContext,
  threads: ChatThread[],
  threshold = CHAT_MATCH_THRESHOLD,
): { thread: ChatThread; score: number } | null {
  if (!threads.length) return null
  let best: ChatThread | null = null
  let bestScore = -1
  for (const t of threads) {
    if (!t.company && !t.jobTitle) continue
    const sc = scoreThreadAgainstActiveContext(ctx, t)
    if (sc > bestScore) {
      bestScore = sc
      best = t
    }
  }
  if (!best || bestScore < threshold) return null
  return { thread: best, score: bestScore }
}

/** 上下文是否足够用于落库/匹配（至少有 title 或 company 或有意义 blob） */
export function activeContextIsUsable(ctx: ActiveChatContext): boolean {
  const title = (ctx.title || '').trim()
  const company = (ctx.company || '').trim()
  const blob = (ctx.blob || '').trim()
  if (title.length >= 2) return true
  if (company.length >= 2) return true
  // blob 过短或只是浏览器标题噪声
  if (blob.length >= 4 && !/^boss|直聘|zhipin|消息/i.test(blob)) return true
  return false
}
