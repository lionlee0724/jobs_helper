import type {
  ActionTiming,
  AnalyticsSummary,
  EventRecord,
  Job,
  LlmConfig,
  MessageAssistConfig,
  Policy,
  Profile,
  RunState,
} from './types'

/** SW ↔ UI ↔ content 消息协议 */

export type ChatSessionMatch = {
  company?: string
  jobTitle?: string
  jobId?: string
}

/** detect_page.data.auth */
export type PageAuthState = 'ok' | 'login' | 'captcha' | 'unknown'

export type ContentCommand =
  | { op: 'ping' }
  | { op: 'sync_profile' }
  | { op: 'list_jobs'; source: Job['source'] }
  | { op: 'open_job'; jobId: string; href?: string }
  | { op: 'extract_job_detail' }
  | { op: 'open_chat'; timing?: ActionTiming }
  | { op: 'read_peer_messages'; limit?: number }
  | { op: 'send_text'; text: string; timing?: ActionTiming }
  /** 增强：等待确认 + 校验成功/失败（fail-closed） */
  | { op: 'send_resume' }
  | { op: 'goto_source'; source: Job['source'] }
  | { op: 'goto_chat' }
  /** data: { href, source, listTab, auth: PageAuthState } */
  | { op: 'detect_page' }
  | { op: 'goto_job_detail'; jobId: string; href?: string }
  /** 点击顶部期望/分类标签，恢复「项目经理/主管」等锁定分类 */
  | { op: 'select_list_tab'; label: string }
  /** data: Array<{ key, title, company?, preview? }> */
  | { op: 'list_chat_sessions' }
  /** 按 company/jobTitle 打开最佳匹配会话；无足够匹配则 fail（S1） */
  | { op: 'open_chat_session'; match: ChatSessionMatch }
  /** 读右侧当前已打开会话页头；data: { title?: string; company?: string; blob: string } */
  | { op: 'read_active_chat_context' }
  /** 诊断：实页选择器标定探针；data: ProbeReport（见 content/adapter/boss/probe.ts） */
  | { op: 'probe_selectors' }

export type ContentResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string }

export type RequestMessage =
  | { type: 'run/start' }
  | { type: 'run/stop'; reason?: string }
  | { type: 'run/status' }
  | { type: 'run/preview' }
  | { type: 'kv/get' }
  | {
      type: 'kv/set'
      policy?: Policy
      llm?: LlmConfig
      profile?: Profile
      messageAssist?: MessageAssistConfig
    }
  | { type: 'profile/sync' }
  | { type: 'llm/test'; llm?: LlmConfig }
  | { type: 'analytics/summary' }
  | { type: 'events/list'; limit?: number }
  | { type: 'export/all' }
  | { type: 'content/exec'; tabId?: number; command: ContentCommand }
  | { type: 'messageAssist/get' }
  | { type: 'messageAssist/set'; config: MessageAssistConfig }
  | { type: 'messageAssist/run'; limit?: number; resetErrors?: boolean }
  /** 只处理消息页右侧当前会话（不扫队列） */
  | { type: 'messageAssist/runCurrent' }
  | { type: 'messageAssist/openChat' }
  | { type: 'messageAssist/resetErrors' }
  /** 从消息列表导入尚未登记的会话 */
  | { type: 'threads/import' }
  /** 启动「处理到队列清空」循环 */
  | { type: 'messageAssist/runAll' }
  /** 停止循环 */
  | { type: 'messageAssist/stopAll' }
  /** 查循环进度 */
  | { type: 'messageAssist/progress' }
  /** 待人工 handoff 列表 */
  | { type: 'handoff/list' }
  /** 标记 handoff 已处理 */
  | { type: 'handoff/resolve'; threadId: string; next?: 'waiting_peer' | 'done' }
  /** 打开并定位 handoff 会话 */
  | { type: 'handoff/open'; threadId: string }
  /** 将合适但开聊失败的岗重新入队 */
  | { type: 'jobs/retryFailedOpen'; jobId?: string }

export type ResponseMessage =
  | {
      type: 'run/status'
      state: RunState
      todayOpened: number
      todayReplies: number
      /** 今日硬否跳过 */
      todayHardRejected?: number
      /** 本 Run 硬否跳过 */
      sessionHardRejected?: number
      /** 异常冷却（若有且未到期） */
      anomaly?: {
        kind: string
        reason?: string
        until: number
        needsHuman?: boolean
      } | null
      /** 运行提示：列表空、分类锁等 */
      notice?: string | null
    }
  | {
      type: 'run/preview'
      ok: true
      listLabel: string
      listUrl: string
      tabId: number
    }
  | { type: 'run/preview'; ok: false; error: string }
  | {
      type: 'kv/get'
      policy: Policy
      llm: LlmConfig
      profile: Profile | null
      messageAssist?: MessageAssistConfig
    }
  | { type: 'ok' }
  | { type: 'error'; error: string }
  | { type: 'analytics/summary'; summary: AnalyticsSummary }
  | { type: 'events/list'; events: EventRecord[] }
  | { type: 'export/all'; payload: unknown }
  | { type: 'content/exec'; result: ContentResult }
  | { type: 'profile/sync'; profile: Profile }
  | {
      type: 'llm/test'
      ok: true
      url: string
      reply: string
      latencyMs: number
      originPattern?: string
    }
  | { type: 'messageAssist/get'; config: MessageAssistConfig }
  | {
      type: 'messageAssist/run'
      ok: boolean
      processed: number
      results: Array<{
        threadId: string
        company?: string
        jobTitle?: string
        action: string
        detail?: string
      }>
      error?: string
    }
  | {
      type: 'messageAssist/runCurrent'
      ok: boolean
      result?: {
        threadId: string
        company?: string
        jobTitle?: string
        action: string
        detail?: string
      }
      error?: string
    }
  | { type: 'messageAssist/openChat'; tabId: number }
  | { type: 'messageAssist/resetErrors'; count: number }
  | {
      type: 'threads/import'
      imported: number
      updated: number
      skipped: number
      scanned: number
    }
  | {
      type: 'messageAssist/progress'
      active: boolean
      processed: number
      remaining: number
      lastAction?: string
      lastError?: string
      stoppedReason?: string
    }
  | {
      type: 'handoff/list'
      items: Array<{
        id: string
        company?: string
        jobTitle?: string
        reason?: string
        lastActionAt?: number
      }>
    }
  | { type: 'handoff/resolve'; ok: boolean }
  | {
      type: 'handoff/open'
      ok: boolean
      located?: boolean
      tabId?: number
      error?: string
    }
  | { type: 'jobs/retryFailedOpen'; requeued: number }

export function isRequestMessage(v: unknown): v is RequestMessage {
  return Boolean(v && typeof v === 'object' && 'type' in (v as object))
}