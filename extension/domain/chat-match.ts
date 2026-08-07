/** 会话列表匹配 / peer 消息游标 — 纯函数，无 DOM */

export type ChatSessionItem = {
  key: string
  title: string
  company?: string
  preview?: string
  /** 列表行是否带未读徐标 */
  unread?: boolean
  /** 徐标上的数字（能读到时） */
  unreadCount?: number
}

export type ChatSessionMatchTarget = {
  company?: string
  jobTitle?: string
  jobId?: string
}

/** 匹配分低于此阈值视为 S1 失败（不点会话）。消息页列表文案噪声大，略降阈值 */
export const CHAT_MATCH_THRESHOLD = 28

const COMPANY_SUFFIXES = [
  '有限责任公司',
  '股份有限公司',
  '有限公司',
  '集团有限公司',
  '集团公司',
  '集团',
  '公司',
  '（中国）',
  '(中国)',
]

/** 规范化：小写、去空白、轻量去公司后缀 */
export function normalizeMatchText(s: string | undefined | null): string {
  let t = (s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·•・]/g, '')
  for (const suf of COMPANY_SUFFIXES) {
    if (t.endsWith(suf.toLowerCase()) && t.length > suf.length + 1) {
      t = t.slice(0, -suf.length)
      break
    }
  }
  return t
}

/**
 * 对单条会话打分（0–100+）。
 * company 权重高，title 次之；精确/包含优先。
 */
export function scoreChatSessionMatch(
  target: ChatSessionMatchTarget,
  session: ChatSessionItem,
): number {
  const tCompany = normalizeMatchText(target.company)
  const tTitle = normalizeMatchText(target.jobTitle)
  const sCompany = normalizeMatchText(session.company || '')
  const sTitle = normalizeMatchText(session.title || '')
  // 会话项可能把「职位 · 公司」塞进 title
  const sBlob = normalizeMatchText(
    [session.title, session.company, session.preview].filter(Boolean).join(' '),
  )

  let score = 0

  if (tCompany) {
    if (sCompany && (sCompany === tCompany || tCompany === sCompany)) {
      score += 60
    } else if (sCompany && (sCompany.includes(tCompany) || tCompany.includes(sCompany))) {
      score += 45
    } else if (sBlob.includes(tCompany)) {
      score += 50 // 消息列表常把公司嵌在整行文案里
    } else if (sTitle.includes(tCompany)) {
      score += 40
    } else {
      // 公司名截断：前 4 字
      const head = tCompany.slice(0, Math.min(4, tCompany.length))
      if (head.length >= 2 && sBlob.includes(head)) score += 28
    }
  }

  if (tTitle) {
    if (sTitle && (sTitle === tTitle || tTitle === sTitle)) {
      score += 35
    } else if (sTitle && (sTitle.includes(tTitle) || tTitle.includes(sTitle))) {
      score += 28
    } else if (sBlob.includes(tTitle)) {
      score += 30
    } else {
      const head = tTitle.slice(0, Math.min(4, tTitle.length))
      if (head.length >= 2 && sBlob.includes(head)) score += 22
    }
  }

  // 仅有 jobId 且 key/title 含 id 时给弱分（不足以单独通过阈值）
  if (target.jobId) {
    const id = target.jobId.toLowerCase()
    if (session.key.toLowerCase().includes(id) || sBlob.includes(id)) {
      score += 15
    }
  }

  return score
}

export function pickBestSession(
  target: ChatSessionMatchTarget,
  sessions: ChatSessionItem[],
  threshold = CHAT_MATCH_THRESHOLD,
): { ok: true; session: ChatSessionItem; score: number } | { ok: false; bestScore: number } {
  if (!sessions.length) return { ok: false, bestScore: 0 }
  let best: ChatSessionItem | null = null
  let bestScore = -1
  for (const s of sessions) {
    const sc = scoreChatSessionMatch(target, s)
    if (sc > bestScore) {
      bestScore = sc
      best = s
    }
  }
  if (!best || bestScore < threshold) {
    return { ok: false, bestScore: Math.max(0, bestScore) }
  }
  return { ok: true, session: best, score: bestScore }
}

/** peer 消息游标指纹：规范化截断，同文案不重复处理 */
export function fingerprintPeer(text: string): string {
  const n = (text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
  return n
}
