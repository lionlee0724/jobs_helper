import type { ChatThread } from '../../shared/types'
import {
  activeContextIsUsable,
  pickBestThreadForActiveContext,
  type ActiveChatContext,
} from '../../domain/resolve-active-thread'
import { getDb } from '../db'

export async function upsertThread(thread: ChatThread): Promise<void> {
  await getDb().chat_threads.put(thread)
}

export async function getThread(id: string) {
  return getDb().chat_threads.get(id)
}

/** @deprecated 用 listFollowableThreads；保留名兼容旧调用 */
export async function listActiveThreads(): Promise<ChatThread[]> {
  return listFollowableThreads()
}

/**
 * 可跟进队列：active | waiting_peer。
 *
 * 排序：**有未读优先**，其次按 lastActionAt 升序（久未跟进优先）。
 * 未读信号来自消息列表扫描（markUnreadSeen），避免反复点开没新消息的会话。
 */
export async function listFollowableThreads(): Promise<ChatThread[]> {
  const rows = await getDb()
    .chat_threads.where('status')
    .anyOf(['active', 'waiting_peer'])
    .toArray()
  return rows.sort(compareFollowable)
}

/** 待人工队列（handoff） */
export async function listHandoffThreads(): Promise<ChatThread[]> {
  const rows = await getDb()
    .chat_threads.where('status')
    .equals('handoff')
    .toArray()
  return rows.sort((a, b) => (b.lastActionAt ?? 0) - (a.lastActionAt ?? 0))
}

/** 人工处理完成：回到 waiting_peer 或 done */
export async function resolveHandoff(
  id: string,
  next: 'waiting_peer' | 'done' = 'done',
): Promise<boolean> {
  const cur = await getDb().chat_threads.get(id)
  if (!cur || cur.status !== 'handoff') return false
  await getDb().chat_threads.put({
    ...cur,
    status: next,
    lastError: undefined,
    lastActionAt: Date.now(),
  })
  return true
}

/**
 * 跟进队列排序规则（纯函数，便于回归）。
 *
 * 1. 有未读的排在前面—— 避免反复点开没新消息的会话白耗操作次数
 * 2. 都有未读时，最近扫到的优先
 * 3. 都无未读时，久未跟进的优先
 */
export function compareFollowable(a: ChatThread, b: ChatThread): number {
  const au = a.unreadSeenAt ?? 0
  const bu = b.unreadSeenAt ?? 0
  if (au > 0 !== bu > 0) return au > 0 ? -1 : 1
  if (au > 0 && bu > 0) return bu - au
  return (a.lastActionAt ?? 0) - (b.lastActionAt ?? 0)
}

/** 扫描到未读：抬升优先级 */
export async function markUnreadSeen(id: string, ts = Date.now()): Promise<void> {
  const cur = await getDb().chat_threads.get(id)
  if (!cur) return
  await getDb().chat_threads.put({ ...cur, unreadSeenAt: ts })
}

/** 已处理完：清未读标记 */
export async function clearUnreadSeen(id: string): Promise<void> {
  const cur = await getDb().chat_threads.get(id)
  if (!cur) return
  await getDb().chat_threads.put({ ...cur, unreadSeenAt: undefined })
}

/**
 * 导入消息列表中尚未登记的会话。
 *
 * 不覆盖已存在的会话（避免抹掉自建会话的职位上下文与处理游标），
 * 仅在命中未读时更新优先级。
 */
export async function importThreads(
  items: Array<{
    key: string
    title: string
    company?: string
    unread?: boolean
  }>,
): Promise<{ imported: number; updated: number; skipped: number }> {
  const db = getDb()
  let imported = 0
  let updated = 0
  let skipped = 0

  for (const it of items) {
    const id = importedThreadId(it)
    const existing = await db.chat_threads.get(id)
    if (existing) {
      if (it.unread) {
        await db.chat_threads.put({ ...existing, unreadSeenAt: Date.now() })
        updated++
      } else {
        skipped++
      }
      continue
    }
    await db.chat_threads.put({
      id,
      company: it.company,
      jobTitle: it.title,
      status: 'waiting_peer',
      source: 'imported',
      unreadSeenAt: it.unread ? Date.now() : undefined,
      lastActionAt: 0,
    })
    imported++
  }
  return { imported, updated, skipped }
}

/**
 * 导入会话的稳定 ID。
 *
 * 不能用会话列表的 key——它包含行序号，列表重排后就变了。
 * 用 公司+标题 作为身份，与 open_chat_session 的匹配维度一致。
 */
export function importedThreadId(it: { title: string; company?: string }): string {
  const norm = (s?: string) => (s || '').replace(/\s+/g, '').toLowerCase()
  return `chat:${norm(it.company)}|${norm(it.title)}`
}

export async function markThread(
  id: string,
  patch: Partial<ChatThread>,
): Promise<void> {
  const cur = await getDb().chat_threads.get(id)
  if (!cur) return
  await getDb().chat_threads.put({ ...cur, ...patch })
}

/** 写入 peer 消息游标 */
export async function markPeerHandled(
  id: string,
  fingerprint: string,
  extra?: Partial<ChatThread>,
): Promise<void> {
  await markThread(id, {
    lastHandledPeerFingerprint: fingerprint,
    lastHandledAt: Date.now(),
    // 已处理完就清未读，否则该会话会永远卡在队列最前面反复被取出
    unreadSeenAt: undefined,
    ...extra,
  })
}

/** S1 / 发简历失败等：标 error 并记原因 */
export async function markThreadError(id: string, error: string): Promise<void> {
  await markThread(id, {
    status: 'error',
    lastError: error.slice(0, 300),
    lastActionAt: Date.now(),
  })
}

/**
 * 定位失败：前 maxFails-1 次保持可跟进，累计到 maxFails 才 error。
 * 避免消息列表 DOM 偶发失败导致会话全红死掉。
 */
export async function markLocateFail(
  id: string,
  error: string,
  maxFails = 3,
): Promise<'retry' | 'dead'> {
  const cur = await getThread(id)
  if (!cur) return 'dead'
  const n = (cur.locateFails ?? 0) + 1
  if (n >= maxFails) {
    await markThread(id, {
      status: 'error',
      locateFails: n,
      lastError: error.slice(0, 300),
      lastActionAt: Date.now(),
    })
    return 'dead'
  }
  await markThread(id, {
    status: 'waiting_peer',
    locateFails: n,
    lastError: `定位失败 ${n}/${maxFails}：${error}`.slice(0, 300),
    lastActionAt: Date.now(),
  })
  return 'retry'
}

/** 把 error 会话拉回可跟进（消息助手「重试失败会话」） */
export async function resetErrorThreads(): Promise<number> {
  const rows = await getDb().chat_threads.where('status').equals('error').toArray()
  let n = 0
  for (const r of rows) {
    await markThread(r.id, {
      status: 'waiting_peer',
      locateFails: 0,
      lastError: undefined,
      lastActionAt: Date.now(),
    })
    n++
  }
  return n
}

export async function listAllThreads() {
  return getDb().chat_threads.toArray()
}

/**
 * 解析「消息页右侧当前会话」对应的 ChatThread：
 * 1) 对库内全部 thread 打分，≥ CHAT_MATCH_THRESHOLD 则复用
 * 2) 否则用稳定 id upsert，source: current_ui（显式点击 ≠ 静默扫列表）
 */
export async function resolveThreadForActiveContext(
  ctx: ActiveChatContext,
): Promise<ChatThread> {
  if (!activeContextIsUsable(ctx)) {
    throw new Error(
      '无法识别当前右侧会话（页头为空）。请确认已打开会话且页头可见。',
    )
  }

  const all = await listAllThreads()
  const hit = pickBestThreadForActiveContext(ctx, all)
  if (hit) {
    // 可选：若曾 error，拉回可跟进（用户显式点当前会话）
    if (hit.thread.status === 'error') {
      await markThread(hit.thread.id, {
        status: 'waiting_peer',
        locateFails: 0,
        lastError: undefined,
        lastActionAt: Date.now(),
      })
      const refreshed = await getThread(hit.thread.id)
      if (refreshed) return refreshed
    }
    return hit.thread
  }

  const title = (ctx.title || ctx.blob.slice(0, 40) || '当前会话').trim()
  const company = (ctx.company || '').trim() || undefined
  const id = importedThreadId({ title, company })
  const existing = await getThread(id)
  if (existing) {
    // 同 id 已存在但打分未过阈值（字段噪声）：仍复用，避免重复行
    if (existing.status === 'error') {
      await markThread(id, {
        status: 'waiting_peer',
        locateFails: 0,
        lastError: undefined,
        lastActionAt: Date.now(),
      })
      return (await getThread(id)) || existing
    }
    return existing
  }

  const thread: ChatThread = {
    id,
    company,
    jobTitle: title,
    status: 'waiting_peer',
    source: 'current_ui',
    lastActionAt: Date.now(),
  }
  await upsertThread(thread)
  return thread
}
