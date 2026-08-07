/** 共享领域类型 — 无 DOM / 无 chrome 副作用 */

/** current = 启动时锁定的当前职位列表页（推荐/期望/自定义分类标签） */
export type JobSource = 'current' | 'recommend' | 'expect1' | 'expect2'

export type ChatIntent =
  | 'resume_request'
  | 'reject'
  | 'other'
  | 'system'
  /** 薪资谈判—— 需人工 */
  | 'salary_question'
  /** 面试邀约—— 需人工 */
  | 'interview_invite'
  /** 索要联系方式—— 需人工 */
  | 'contact_request'
  /** 到岗时间—— 可自动 */
  | 'availability_question'
  /** 工作地点—— 可自动 */
  | 'location_question'

export type EventType =
  | 'run_start'
  | 'run_pause'
  | 'run_resume'
  | 'job_seen'
  | 'job_matched'
  | 'job_skipped'
  | 'chat_open'
  | 'chat_reply'
  | 'resume_sent'
  /** 需人工处理的会话 */
  | 'handoff'
  | 'error'
  | 'captcha'
  | 'auth_lost'
  | 'tick'

export type Profile = {
  syncedAt: number
  /** 可编辑：LLM 归纳或用户手写，匹配/聊天主用 */
  summary: string
  skills: string[]
  /** 页面抓取全文，供 LLM 与二次分析 */
  rawText?: string
  years?: string
  education?: string
  expectRoles?: string[]
  highlights?: string[]
  analyzedByLlm?: boolean
}

export type Policy = {
  enabled: boolean
  dailyOpenChatLimit?: number
  minIntervalMs?: number
  maxIntervalMs?: number
  dailyReplyLimit?: number
  /** 本轮 run 内开聊硬顶；undefined = 不启用 */
  sessionMaxOpenChat?: number
  /** 本轮 run 内自动文字回复硬顶；undefined = 不启用 */
  sessionMaxReplies?: number
  /**
   * balanced 模式下：关键词命中 ≥ 此值可作为「值得一试」软通道（默认 2；0=关闭软通道）。
   */
  matchMinKeywordHits?: number
  /**
   * balanced（默认）| keywords_only | llm_only
   * keywords_or_llm 为 balanced 别名
   */
  matchMode?: 'balanced' | 'keywords_only' | 'llm_only' | 'keywords_or_llm'

  // —— 风控（默认保守档）——

  /** 风控预设档位；custom = 不用预设，全走手填值 */
  riskProfile?: RiskProfile
  /** 小时开聊上限：避免日配额在短时间内集中消耗 */
  hourlyOpenChatLimit?: number
  /** 活跃时段起始小时（本地时间，0-23，含） */
  activeHourStart?: number
  /** 活跃时段结束小时（本地时间，0-23，不含） */
  activeHourEnd?: number
  /** 允许运行的星期（0=周日 … 6=周六）；undefined = 不限 */
  activeWeekdays?: number[]
  /** 行为拟真强度 */
  humanize?: HumanizeLevel
  /** 异常退避起步毫秒 */
  backoffBaseMs?: number
  /** 异常退避上限毫秒 */
  backoffMaxMs?: number

  // —— 匹配阈值与硬否规则 ——

  /** 开聊所需最低综合分（空则用 DEFAULT_MIN_MATCH_SCORE） */
  minMatchScore?: number
  /** LLM 权重（0-1），默认 0.75；关键词权重 = 1 - LLM权重 */
  matchLlmWeight?: number
  /** 期望城市；空 = 不限 */
  expectCities?: string[]
  /** 最低薪资（K/月）；职位薪资上限低于此值则拒绝 */
  minSalaryK?: number
  /** 标题或 JD 命中即拒绝的词 */
  excludeKeywords?: string[]
  /** 年限差距容忍（年） */
  maxYearsGap?: number

  /**
   * 职位线 tick 内是否交替跑环 B（会话跟进）。
   * 默认 false/undefined = 关闭；跟进交给消息助手。
   * true = 与开聊交替跟进（旧行为）。
   */
  followUpInJobRun?: boolean

  // —— 界面偏好（不影响匹配公式 / fail-soft）——

  /**
   * 侧栏/报告主题。
   * dark（默认）| light | system（跟随 OS）
   */
  uiTheme?: 'dark' | 'light' | 'system'
  /**
   * 扩展页快捷键（侧栏/报告已有动作）。
   * 默认 true；false = 关闭。不注入 BOSS 内容页。
   */
  shortcutsEnabled?: boolean
}

/**
 * 开聊最低综合分默认值（留空 policy 时运行时生效）。
 * 唯一合同源：domain/UI/scheduler 禁止再写死数字；空/非法走 resolveMinScore。
 * 现行合同 = 50（自 55 下调以提高开聊率，并由画像/过往岗位洞察补偿）。
 */
export const DEFAULT_MIN_MATCH_SCORE = 50


/**
 * 下发给 content 的动作时间形态。
 *
 * content 不持有策略，只执行 SW 算好的区间；区间为 [最小, 最大] 毫秒。
 */
export type ActionTiming = {
  readDwellMs?: [number, number]
  preClickMs?: [number, number]
  typingCharMs?: [number, number]
  preSendMs?: [number, number]
  scroll?: boolean
}

export type RiskProfile = 'conservative' | 'balanced' | 'aggressive' | 'custom'

export type HumanizeLevel = 'off' | 'light' | 'strong'

/** 异常信号分级：决定退避强度与是否停机 */
export type AnomalyKind =
  | 'captcha'
  | 'auth_lost'
  | 'rate_hint'
  | 'action_failed'
  | 'content_dead'

export type LlmConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export type RunState =
  | { status: 'idle' }
  | {
      status: 'running'
      phase: string
      workerTabId: number
      cursor: RunCursor
      lastTickAt?: number
      startedAt: number
      /** 本轮 run 已开聊次数（startRun 清零） */
      sessionOpened?: number
      /** 本轮 run 已自动回复次数（startRun 清零） */
      sessionReplies?: number
    }
  | { status: 'paused'; reason: string; workerTabId?: number }

export type RunCursor = {
  sourceIndex: number
  /** 环 A / 环 B 交替 */
  preferFollowUp: boolean
  /**
   * 启动时锁定的职位列表 URL。
   * 用于「当前分类」模式：不强制跳回推荐页。
   */
  listUrl?: string
  /** 展示用：当前分类标签名（若能识别） */
  listLabel?: string
}

export type Job = {
  id: string
  title: string
  company: string
  salary?: string
  city?: string
  desc: string
  source: JobSource
}

export type MatchResult = {
  suitable: boolean
  reasons: string[]
  confidence?: number
  /** 综合分 0-100（分档评分上线后写入） */
  score?: number
  /** strong | moderate | weak | reject */
  tier?: 'strong' | 'moderate' | 'weak' | 'reject'
  /**
   * 决策通道（新写入可读；旧 job 可能缺省）
   * hard_reject = 硬否；llm_error = 匹配 LLM 不可用（非语义低分）；
   * skip/llm/keywords/hybrid 结合 suitable/score 区分低分跳过
   */
  via?: 'llm' | 'keywords' | 'hybrid' | 'hard_reject' | 'skip' | 'llm_error'
}

export type JobRecord = Job & {
  firstSeenAt: number
  lastSeenAt: number
  match?: MatchResult & { model?: string; matchedAt: number }
  outcome?: 'skipped' | 'opened' | 'failed' | 'unknown'
  openChatAt?: number
  /**
   * 最近一次动作失败摘要（如 open_chat 错误）。
   * 不覆盖 match；看板「失败」列/理由列可读。
   */
  lastError?: string
}

export type EventRecord = {
  id: string
  ts: number
  day: string
  type: EventType
  jobId?: string
  threadId?: string
  payload?: Record<string, unknown>
}

export type ChatThread = {
  id: string
  jobId?: string
  company?: string
  /** 开聊时写入，用于会话列表匹配 */
  jobTitle?: string
  /**
   * 会话来源：
   * - self：本扩展开聊写入（有职位上下文）
   * - imported：从消息列表导入（可能无职位上下文，回复需更保守）
   * - current_ui：用户在消息页显式点「处理当前会话」落库（≠ 静默扫列表）
   */
  source?: 'self' | 'imported' | 'current_ui'
  /** 最近一次扫描到未读的时间；用于优先排序 */
  unreadSeenAt?: number
  status: 'active' | 'waiting_peer' | 'done' | 'error' | 'handoff'
  lastPeerAt?: number
  lastActionAt?: number
  resumeSentAt?: number
  /** 已处理 peer 消息指纹，同文案不重复触发 */
  lastHandledPeerFingerprint?: string
  lastHandledAt?: number
  /** S1 / 发简历失败等原因 */
  lastError?: string
  /** 会话定位失败次数；&lt;3 可重试，≥3 才标 error */
  locateFails?: number
}

/** 消息页助手开关（侧栏 + 消息页浮层共用） */
export type MessageAssistConfig = {
  /** 是否启用消息线自动跟进（可与职位线独立） */
  enabled: boolean
  /** 每轮最多处理会话数 */
  batchSize?: number
  /**
   * 自治级别：
   * - graded（默认）：常见问题自动，敏感/复杂转人工
   * - resume_only：仅处理发简历，其余全部转人工
   * - full_auto：全部自动（高风险）
   */
  autonomy?: 'graded' | 'resume_only' | 'full_auto'
}

export type DailyStats = {
  day: string
  seen: number
  matchedSuitable: number
  matchedUnsuitable: number
  opened: number
  replies: number
  resumesSent: number
  errors: number
  bySource?: Partial<Record<JobSource, number>>
}

export type GuardResult = { ok: true } | { ok: false; reason: string }

export type AnalyticsSummary = {
  today: DailyStats
  last7: DailyStats[]
  suitableRate: number | null
}

export const DEFAULT_POLICY: Policy = {
  enabled: false,
  riskProfile: 'conservative',
}

export const DEFAULT_LLM: LlmConfig = {
  baseUrl: '',
  apiKey: '',
  model: '',
}

/** 默认只跑「当前列表」；不再自动在 recommend/expect 间硬切 */
export const JOB_SOURCES: JobSource[] = ['current']
