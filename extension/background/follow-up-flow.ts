/**
 * 环 B 跟进 + 消息助手：会话定位、意图处理、回复/简历/handoff。
 */
import {
  canReplyMoreToday,
  canReplyMoreThisSession,
} from '../domain/policy'
import { humanTiming } from '../domain/risk'
import {
  buildChatReplyMessages,
  parseChatReply,
  screenOutgoingText,
} from '../domain/chat-llm'
import { classifyIntent, handlingFor, handoffReason } from '../domain/intent'
import type { ChatSessionItem } from '../domain/chat-match'
import { fingerprintPeer } from '../domain/chat-match'
import { CHAT_LLM_EXTRA_RETRIES, chatCompletion } from './llm-client'
import * as kv from '../data/kv'
import { appendEvent } from '../data/repos/events'
import * as jobsRepo from '../data/repos/jobs'
import * as threadsRepo from '../data/repos/chat-threads'
import { getDaily } from '../data/repos/daily-stats'
import { BOSS_URLS, isChatUrl } from '../shared/boss-urls'
import {
  BatchOutcome,
  bumpSessionReplies,
  getSessionCounters,
  isStillRunning,
  setPhase,
  sleep,
  stopRun,
} from './run-context'
import { detectAndPauseIfAuthLost } from './run-guards'
import {
  ensureOnListPage,
  resolveListLabel,
  resolveListUrl,
  sendToTabOnce,
  waitTabComplete,
  withChatTab,
  withEphemeralChatTab,
} from './tab-runtime'

/**
 * 环 B：listFollowable → ephemeral chat tab → FollowUpKernel → restore list。
 * 处置逻辑只走 processFollowUpOnTab（ADR-0001），禁止再内联 intent/LLM/send。
 */
export async function runFollowUpBatch(
  workerTabId: number,
  gen: number,
): Promise<BatchOutcome> {
  if (!(await isStillRunning(gen))) return 'none'

  await setPhase('follow_up', gen)
  const threads = await threadsRepo.listFollowableThreads()
  if (!threads.length) return 'none'

  const thread = threads[0]
  const listUrl = await resolveListUrl(workerTabId)
  const listLabel = await resolveListLabel()

  const session = await withEphemeralChatTab(gen, async (chatTabId) => {
    if (await detectAndPauseIfAuthLost(chatTabId, gen)) {
      return { kind: 'paused' as const }
    }
    const result = await processFollowUpOnTab(chatTabId, thread, {
      via: 'job_run',
    })
    return { kind: 'kernel' as const, result }
  })

  if (await isStillRunning(gen)) {
    await ensureOnListPage(workerTabId, listUrl, gen, listLabel)
  }

  if (!session.ok) {
    await appendEvent({
      type: 'error',
      threadId: thread.id,
      payload: { error: session.error, op: 'follow_up_chat_tab' },
    })
    return 'soft_fail'
  }

  if (session.value.kind === 'paused') return 'none'

  const action = session.value.result.action
  if (action === 'reply_cap') {
    await stopRun(session.value.result.detail || '已达回复上限')
    return 'none'
  }
  if (action === 'read_fail') {
    await appendEvent({
      type: 'error',
      threadId: thread.id,
      payload: {
        error: session.value.result.detail,
        op: 'read_peer_messages',
        via: 'job_run',
      },
    })
    return 'soft_fail'
  }
  if (
    action === 'locate_retry' ||
    action === 'locate_dead' ||
    action === 'resume_sent' ||
    action === 'resume_fail' ||
    action === 'handoff' ||
    action === 'mark_done_reject' ||
    action === 'replied' ||
    action === 'send_fail'
  ) {
    return 'progress'
  }
  return 'none'
}

export type MessageAssistItemResult = {
  threadId: string
  company?: string
  jobTitle?: string
  action: string
  detail?: string
}

export type MessageAssistResult = {
  ok: boolean
  processed: number
  results: MessageAssistItemResult[]
  error?: string
}

export type MessageAssistCurrentResult = {
  ok: boolean
  result?: MessageAssistItemResult
  error?: string
}

type ProcessFollowUpOpts = {
  /** 已在当前右侧会话：跳过 open_chat_session */
  skipOpen?: boolean
  /** 事件 via 标记 */
  via?: 'message_assist' | 'current_session' | 'job_run'
  /** 队列路径：处理前把 lastActionAt 沉底，避免死循环 */
  sinkToBottom?: boolean
}

/**
 * 单会话跟进内核：open（可选）→ 读 peer → 意图 → resume/reply/handoff。
 * 环 B / 处理一轮 / 处理当前会话共用，禁止复制大段。
 */
export async function processFollowUpOnTab(
  chatTabId: number,
  thread: import('../shared/types').ChatThread,
  opts?: ProcessFollowUpOpts,
): Promise<MessageAssistItemResult> {
  const via = opts?.via ?? 'message_assist'
  const assist = await kv.getMessageAssist()
  const policy = await kv.getPolicy()

  let jobTitle = thread.jobTitle
  let company = thread.company
  if (thread.jobId) {
    const jobRec = await jobsRepo.getJob(thread.jobId)
    if (jobRec) {
      if (!jobTitle) jobTitle = jobRec.title
      if (!company) company = jobRec.company
    }
  }

  const base = (): Pick<
    MessageAssistItemResult,
    'threadId' | 'company' | 'jobTitle'
  > => ({
    threadId: thread.id,
    company,
    jobTitle,
  })

  if (opts?.sinkToBottom) {
    await threadsRepo.markThread(thread.id, { lastActionAt: Date.now() })
  }

  if (!opts?.skipOpen) {
    const opened = await sendToTabOnce(chatTabId, {
      op: 'open_chat_session',
      match: { company, jobTitle, jobId: thread.jobId },
    })
    if (!opened.ok) {
      const fate = await threadsRepo.markLocateFail(
        thread.id,
        opened.error || '会话定位失败',
      )
      await appendEvent({
        type: 'error',
        threadId: thread.id,
        payload: {
          error: opened.error,
          op: 'message_assist_locate',
          fate,
          via,
        },
      })
      return {
        ...base(),
        action: fate === 'dead' ? 'locate_dead' : 'locate_retry',
        detail: opened.error,
      }
    }
    await threadsRepo.markThread(thread.id, {
      locateFails: 0,
      lastError: undefined,
    })
    await sleep(900)
  } else {
    await sleep(400)
  }

  const msgs = await sendToTabOnce(chatTabId, {
    op: 'read_peer_messages',
    limit: 8,
  })
  if (!msgs.ok) {
    return { ...base(), action: 'read_fail', detail: msgs.error }
  }
  const list = (msgs.data as string[]) || []
  const latest = list[list.length - 1] || ''
  if (!latest) {
    await threadsRepo.markThread(thread.id, {
      status: 'waiting_peer',
      lastActionAt: Date.now(),
    })
    return { ...base(), action: 'no_peer_msg' }
  }

  // 重新读 thread 游标（可能刚 upsert）
  const fresh = (await threadsRepo.getThread(thread.id)) || thread
  const fp = fingerprintPeer(latest)
  if (
    fresh.lastHandledPeerFingerprint &&
    fresh.lastHandledPeerFingerprint === fp
  ) {
    await threadsRepo.markThread(thread.id, {
      status: 'waiting_peer',
      lastActionAt: Date.now(),
    })
    return { ...base(), action: 'already_handled' }
  }

  const intent = classifyIntent(latest)
  const profile = await kv.getProfile()
  if (!profile) {
    return {
      ...base(),
      action: 'no_profile',
      detail: '请先同步简历画像',
    }
  }

  if (intent === 'system') {
    await threadsRepo.markPeerHandled(thread.id, fp, {
      status: 'waiting_peer',
      lastPeerAt: Date.now(),
      lastActionAt: Date.now(),
    })
    return { ...base(), action: 'skip_system' }
  }

  if (intent === 'reject') {
    await threadsRepo.markPeerHandled(thread.id, fp, {
      status: 'done',
      lastPeerAt: Date.now(),
      lastActionAt: Date.now(),
    })
    return {
      ...base(),
      action: 'mark_done_reject',
      detail: latest.slice(0, 80),
    }
  }

  // 分级自治：与环 B 一致，敏感意图挂起等人工
  {
    const autonomy = assist.autonomy ?? 'graded'
    const handling = handlingFor(intent)
    const needsHandoff =
      autonomy === 'full_auto'
        ? false
        : autonomy === 'resume_only'
          ? handling !== 'auto_action'
          : handling === 'handoff'
    if (needsHandoff) {
      const reason = handoffReason(intent)
      await threadsRepo.markPeerHandled(thread.id, fp, {
        status: 'handoff',
        lastPeerAt: Date.now(),
        lastActionAt: Date.now(),
        lastError: `待人工：${reason}`,
      })
      await appendEvent({
        type: 'handoff',
        threadId: thread.id,
        jobId: thread.jobId,
        payload: {
          intent,
          reason,
          peerText: latest.slice(0, 200),
          via,
        },
      })
      return { ...base(), action: 'handoff', detail: reason }
    }
  }

  if (intent === 'resume_request') {
    const r = await sendToTabOnce(chatTabId, { op: 'send_resume' })
    if (!r.ok) {
      await threadsRepo.markThreadError(thread.id, r.error || '发简历失败')
      await appendEvent({
        type: 'error',
        threadId: thread.id,
        payload: { error: r.error, op: 'send_resume', via },
      })
      return { ...base(), action: 'resume_fail', detail: r.error }
    }
    await threadsRepo.markPeerHandled(thread.id, fp, {
      resumeSentAt: Date.now(),
      lastActionAt: Date.now(),
      lastPeerAt: Date.now(),
      status: 'waiting_peer',
    })
    await appendEvent({
      type: 'resume_sent',
      threadId: thread.id,
      jobId: thread.jobId,
      payload: { via },
    })
    return { ...base(), action: 'resume_sent' }
  }

  // other → LLM 回复；日上限 +（职位线 running 时）本轮回复上限双门闩
  const daily2 = await getDaily()
  const g = canReplyMoreToday(policy, daily2.replies)
  if (!g.ok) {
    return { ...base(), action: 'reply_cap', detail: g.reason }
  }
  const runSt = await kv.getRunState()
  if (runSt.status === 'running') {
    const sessReply = canReplyMoreThisSession(
      policy,
      runSt.sessionReplies ?? 0,
    )
    if (!sessReply.ok) {
      return { ...base(), action: 'reply_cap', detail: sessReply.reason }
    }
  }

  try {
    const llm = await kv.getLlmConfig()
    const job = thread.jobId ? await jobsRepo.getJob(thread.jobId) : undefined
    const raw = await chatCompletion(
      llm,
      buildChatReplyMessages({
        profile,
        job: job
          ? {
              id: job.id,
              title: job.title,
              company: job.company,
              salary: job.salary,
              city: job.city,
              desc: job.desc,
              source: job.source,
            }
          : undefined,
        peerText: latest,
        history: list.slice(-5).join('\n'),
        intent,
      }),
      { retries: CHAT_LLM_EXTRA_RETRIES },
    )
    const text = parseChatReply(raw)

    const screen = screenOutgoingText(text)
    if (!screen.ok) {
      await threadsRepo.markPeerHandled(thread.id, fp, {
        status: 'waiting_peer',
        lastPeerAt: Date.now(),
        lastActionAt: Date.now(),
        lastError: `待人工：回复内容含${screen.violation}，已拦截`,
      })
      await appendEvent({
        type: 'handoff',
        threadId: thread.id,
        jobId: thread.jobId,
        payload: {
          reason: `拦截出站${screen.violation}`,
          intent,
          via,
        },
      })
      return {
        ...base(),
        action: 'handoff',
        detail: `回复含${screen.violation}，已拦截`,
      }
    }

    const sent = await sendToTabOnce(chatTabId, {
      op: 'send_text',
      text,
      timing: humanTiming(policy),
    })
    if (!sent.ok) {
      return { ...base(), action: 'send_fail', detail: sent.error }
    }
    await threadsRepo.markPeerHandled(thread.id, fp, {
      lastActionAt: Date.now(),
      lastPeerAt: Date.now(),
      status: 'waiting_peer',
    })
    if (runSt.status === 'running') await bumpSessionReplies()
    await appendEvent({
      type: 'chat_reply',
      threadId: thread.id,
      jobId: thread.jobId,
      payload: { text: text.slice(0, 200), via },
    })
    return {
      ...base(),
      action: 'replied',
      detail: text.slice(0, 80),
    }
  } catch (e) {
    return {
      ...base(),
      action: 'llm_fail',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * 消息页助手：在用户打开的消息页上处理最多 limit 个可跟进会话。
 * 不要求职位线 running；受日回复/本轮回复上限约束（本轮无 run 时仅日上限）。
 */
export async function runMessageAssist(opts?: {
  limit?: number
  resetErrors?: boolean
}): Promise<MessageAssistResult> {
  const assist = await kv.getMessageAssist()
  const limit = Math.max(1, Math.min(20, opts?.limit ?? assist.batchSize ?? 5))
  const results: MessageAssistResult['results'] = []

  if (opts?.resetErrors) {
    const n = await threadsRepo.resetErrorThreads()
    results.push({
      threadId: '*',
      action: 'reset_errors',
      detail: `已重置 ${n} 个错误会话`,
    })
  }

  const policy = await kv.getPolicy()
  const daily = await getDaily()
  const replyGuard = canReplyMoreToday(policy, daily.replies)
  if (!replyGuard.ok) {
    return { ok: false, processed: 0, results, error: replyGuard.reason }
  }

  let threads = await threadsRepo.listFollowableThreads()
  if (!threads.length) {
    return {
      ok: true,
      processed: 0,
      results,
      error: '没有可跟进会话（可先跑职位线开聊，或「重置错误会话」）',
    }
  }

  const session = await withChatTab(null, async (chatTabId) => {
    let processed = 0
    for (let i = 0; i < limit; i++) {
      threads = await threadsRepo.listFollowableThreads()
      const thread = threads[0]
      if (!thread) break

      const item = await processFollowUpOnTab(chatTabId, thread, {
        skipOpen: false,
        via: 'message_assist',
        sinkToBottom: true,
      })
      results.push(item)
      processed++
      if (item.action === 'no_profile' || item.action === 'reply_cap') break
      await sleep(600)
    }
    return { processed }
  })

  if (!session.ok) {
    return { ok: false, processed: 0, results, error: session.error }
  }
  return {
    ok: true,
    processed: session.value.processed,
    results,
  }
}

/**
 * 只处理消息页右侧当前已打开会话：读上下文 → resolve/upsert thread → 跟进内核。
 * 不遍历左侧列表、不扫库内队列。
 */
export async function processCurrentChatSession(): Promise<MessageAssistCurrentResult> {
  const policy = await kv.getPolicy()
  const daily = await getDaily()
  const replyGuard = canReplyMoreToday(policy, daily.replies)
  if (!replyGuard.ok) {
    return { ok: false, error: replyGuard.reason }
  }

  const session = await withChatTab(
    null,
    async (chatTabId) => {
      const ctxRes = await sendToTabOnce(chatTabId, {
        op: 'read_active_chat_context',
      })
      if (!ctxRes.ok) {
        throw new Error(ctxRes.error || '读取当前会话上下文失败')
      }
      const ctx = ctxRes.data as {
        title?: string
        company?: string
        blob: string
      }
      if (
        !ctx ||
        (!(ctx.title || '').trim() &&
          !(ctx.company || '').trim() &&
          !(ctx.blob || '').trim())
      ) {
        throw new Error(
          '未检测到右侧已打开会话。请先在消息页点开一个会话，再点「处理当前会话」。',
        )
      }

      let thread: import('../shared/types').ChatThread
      try {
        thread = await threadsRepo.resolveThreadForActiveContext(ctx)
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e))
      }

      const item = await processFollowUpOnTab(chatTabId, thread, {
        skipOpen: true,
        via: 'current_session',
        sinkToBottom: false,
      })
      return item
    },
    { preferExisting: true, allowCreate: false },
  )

  if (!session.ok) {
    return { ok: false, error: session.error }
  }
  return { ok: true, result: session.value }
}

/**
 * 扫描消息列表会话（供导入与未读优先级更新）。
 *
 * 标签管理留在 scheduler（其 owner），循环控制在 message-assist-loop。
 */
export async function scanChatSessions(): Promise<
  { ok: true; sessions: ChatSessionItem[] } | { ok: false; error: string }
> {
  const r = await withChatTab(null, async (chatTabId) => {
    const res = await sendToTabOnce(chatTabId, { op: 'list_chat_sessions' })
    if (!res.ok) throw new Error(res.error || '读取会话列表失败')
    return (res.data as ChatSessionItem[]) || []
  })
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, sessions: r.value }
}

export async function openBossChatTab(): Promise<number> {
  const tabs = await chrome.tabs.query({
    url: ['*://*.zhipin.com/*chat*', '*://*.bosszhipin.com/*chat*'],
  })
  const existing = tabs.find((t) => t.id != null && isChatUrl(t.url))
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId != null) {
      try {
        await chrome.windows.update(existing.windowId, { focused: true })
      } catch {
        /* ignore */
      }
    }
    return existing.id
  }
  const tab = await chrome.tabs.create({ url: BOSS_URLS.chat, active: true })
  if (tab.id == null) throw new Error('无法打开消息页')
  await waitTabComplete(tab.id)
  return tab.id
}

/**
 * 打开消息页并尽量定位 handoff 会话。
 */
export async function openHandoffThread(threadId: string): Promise<
  | { ok: true; tabId: number; located: boolean }
  | { ok: false; error: string }
> {
  const thread = await threadsRepo.getThread(threadId)
  if (!thread) return { ok: false, error: '会话不存在或已删除' }
  let tabId: number
  try {
    tabId = await openBossChatTab()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  await sleep(600)
  const match = {
    company: thread.company,
    jobTitle: thread.jobTitle,
    jobId: thread.jobId,
  }
  if (!match.company && !match.jobTitle && !match.jobId) {
    return {
      ok: true,
      tabId,
      located: false,
    }
  }
  const opened = await sendToTabOnce(tabId, {
    op: 'open_chat_session',
    match,
  })
  if (!opened.ok) {
    return {
      ok: false,
      error: `消息页已打开，但定位会话失败：${opened.error || '未知'}。请手动搜索 ${[thread.company, thread.jobTitle].filter(Boolean).join(' · ')}`,
    }
  }
  return { ok: true, tabId, located: true }
}
