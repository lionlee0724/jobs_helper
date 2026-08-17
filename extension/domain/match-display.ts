import type { JobRecord } from '../shared/types'

/** 看板匹配结果标签（禁止对 llm_error 写「低分 N」） */
export function matchLabel(j: JobRecord): { text: string; cls: string } {
  if (!j.match) return { text: '未匹配', cls: 'muted' }
  if (j.match.suitable) {
    const score = j.match.score != null ? ` · ${j.match.score}` : ''
    return { text: `合适${score}`, cls: 'ok' }
  }
  if (j.match.via === 'llm_error') return { text: 'LLM失败', cls: 'warn' }
  if (j.match.via === 'hard_reject') return { text: '硬否', cls: 'bad' }
  if (j.match.score != null) return { text: `低分 ${j.match.score}`, cls: 'bad' }
  return { text: '不合适', cls: 'bad' }
}

/** 看板动作结果标签（与 match 列分离：合适仍可 outcome=failed） */
export function outcomeLabel(j: JobRecord): { text: string; cls: string } {
  if (j.outcome === 'opened') return { text: '已开聊', cls: 'ok' }
  if (j.outcome === 'failed') {
    // 匹配过线后开聊失败：明确写「开聊失败」，避免理解成匹配失败
    if (j.match?.suitable) return { text: '开聊失败', cls: 'bad' }
    return { text: '失败', cls: 'bad' }
  }
  if (j.outcome === 'skipped') return { text: '已跳过', cls: 'muted' }
  if (j.match?.suitable === true) return { text: '合适未开', cls: 'warn' }
  if (j.match?.suitable === false) return { text: '不合适', cls: 'bad' }
  return { text: '仅浏览', cls: 'muted' }
}

/** 看板理由摘要：优先 reasons[0]，硬否/LLM失败/低分加前缀；兼容旧 job 无 via */
export function matchReasonSummary(j: JobRecord): string {
  // 开聊失败：理由列优先展示 lastError，再补匹配摘要
  if (j.outcome === 'failed' && j.lastError) {
    const matchBit =
      j.match?.suitable && j.match.score != null
        ? `（匹配合适 · ${j.match.score}）`
        : j.match?.suitable
          ? '（匹配合适）'
          : ''
    return `开聊失败 · ${j.lastError}${matchBit}`.slice(0, 160)
  }

  if (!j.match) return '—'
  const reasons = j.match.reasons || []
  const head = reasons[0] || ''
  const score = j.match.score
  if (j.match.via === 'llm_error') {
    const detail = head.replace(/^LLM 失败[：:]?\s*/, '') || reasons.slice(0, 2).join('；')
    return `LLM失败${detail ? ' · ' + detail : ''}`.slice(0, 160)
  }
  if (j.match.via === 'hard_reject') {
    const detail = head || reasons.slice(0, 2).join('；')
    return `硬否${detail ? '：' + detail : ''}`.slice(0, 160)
  }
  // 仅真低分（有 score 且非 llm_error）才标「低分」
  if (!j.match.suitable && score != null) {
    return `低分 ${score}${head ? ' · ' + head : ''}`.slice(0, 160)
  }
  if (head) return reasons.slice(0, 2).join('；').slice(0, 160)
  if (score != null) return `分 ${score}`
  return '—'
}

/** open_chat 重试退避毫秒（attempt 从 0 起） */
export function openChatRetryDelayMs(attempt: number): number {
  if (attempt <= 0) return 0
  if (attempt === 1) return 1200
  if (attempt === 2) return 2500
  return 4000
}

/** 匹配 LLM 调用约定：初试 + extraRetries */
export const MATCH_LLM_EXTRA_RETRIES = 2
export const MATCH_LLM_TOTAL_ATTEMPTS = MATCH_LLM_EXTRA_RETRIES + 1

export function formatLlmMatchFailureReason(err: string): string {
  const detail = (err || '未知错误').replace(/\s+/g, ' ').trim().slice(0, 120)
  return `LLM 失败（已重试 ${MATCH_LLM_TOTAL_ATTEMPTS} 次仍失败）：${detail}`
}
