import { describe, expect, it } from 'vitest'
import {
  formatLlmMatchFailureReason,
  matchReasonSummary,
  openChatRetryDelayMs,
  outcomeLabel,
  MATCH_LLM_TOTAL_ATTEMPTS,
} from '../../extension/domain/match-display'
import type { JobRecord } from '../../extension/shared/types'

const base = (over: Partial<JobRecord> = {}): JobRecord => ({
  id: 'j1',
  title: '项目经理',
  company: 'A',
  desc: 'x',
  source: 'current',
  firstSeenAt: 1,
  lastSeenAt: 1,
  ...over,
})

describe('outcomeLabel / open-chat fail UX', () => {
  it('suitable + failed → 开聊失败（不是匹配失败）', () => {
    const j = base({
      match: {
        suitable: true,
        score: 75,
        reasons: ['高度重合'],
        matchedAt: 1,
        via: 'hybrid',
      },
      outcome: 'failed',
      lastError: '页面无可见的「立即沟通」候选元素',
    })
    expect(outcomeLabel(j)).toEqual({ text: '开聊失败', cls: 'bad' })
    expect(matchReasonSummary(j)).toMatch(/开聊失败/)
    expect(matchReasonSummary(j)).toMatch(/立即沟通/)
    expect(matchReasonSummary(j)).toMatch(/75/)
  })

  it('failed without suitable match still 失败', () => {
    const j = base({
      outcome: 'failed',
      lastError: 'x',
      match: { suitable: false, reasons: ['x'], matchedAt: 1 },
    })
    expect(outcomeLabel(j).text).toBe('失败')
  })
})

describe('openChatRetryDelayMs', () => {
  it('backoff schedule', () => {
    expect(openChatRetryDelayMs(0)).toBe(0)
    expect(openChatRetryDelayMs(1)).toBe(1200)
    expect(openChatRetryDelayMs(2)).toBe(2500)
  })
})

describe('formatLlmMatchFailureReason', () => {
  it('states total attempts', () => {
    const s = formatLlmMatchFailureReason('请求超时（45000ms）')
    expect(s).toMatch(new RegExp(`已重试 ${MATCH_LLM_TOTAL_ATTEMPTS} 次`))
    expect(s).toMatch(/超时/)
  })
})
