import { describe, expect, it } from 'vitest'
import {
  decideJobMatch,
  decisionToMatchResult,
  DEFAULT_MIN_MATCH_SCORE,
} from '../../extension/domain/match-decision'
import type { Job, Profile } from '../../extension/shared/types'
import { matchLabel, matchReasonSummary } from '../../extension/domain/match-display'
import type { JobRecord } from '../../extension/shared/types'

const profile: Profile = {
  syncedAt: 1,
  summary: '十年项目管理',
  skills: ['项目管理', '销售管理'],
  years: '10年',
}

const jobPm: Job = {
  id: '1',
  title: '产业工程高级销售经理',
  company: '某某',
  desc: '负责产业园项目拓展与销售管理，ToB 大客户，熟悉项目管理流程',
  source: 'current',
}

describe('decideJobMatch — llm_error fail-soft', () => {
  it('balanced + llmError → via=llm_error，无 score，suitable=false', () => {
    const d = decideJobMatch({
      profile,
      job: jobPm,
      policy: { enabled: true, matchMode: 'balanced' },
      llm: null,
      llmError: 'LLM 请求超时（45000ms）',
    })
    expect(d.via).toBe('llm_error')
    expect(d.suitable).toBe(false)
    expect(d.score).toBeUndefined()
    expect(d.reasons[0]).toMatch(/LLM 失败/)
    expect(d.reasons[0]).toMatch(/超时/)
    // 禁止关键词假分冒充
    expect(d.reasons.join('')).not.toMatch(/关键词命中/)
  })

  it('llm_only + llmError → via=llm_error，无假 0 分冒充评过', () => {
    const d = decideJobMatch({
      profile,
      job: jobPm,
      policy: { enabled: true, matchMode: 'llm_only' },
      llmError: 'LLM HTTP 503 @ https://x: busy',
    })
    expect(d.via).toBe('llm_error')
    expect(d.score).toBeUndefined()
    expect(d.suitable).toBe(false)
  })

  it('keywords_only 不走 llm_error', () => {
    const d = decideJobMatch({
      profile,
      job: jobPm,
      policy: { enabled: true, matchMode: 'keywords_only', matchMinKeywordHits: 2 },
      llmError: 'should be ignored',
    })
    expect(d.via).not.toBe('llm_error')
    expect(d.score).toBeDefined()
  })

  it('真低分（LLM 成功且综合分 < 阈值）仍 via=skip 且有 score', () => {
    const d = decideJobMatch({
      profile,
      job: {
        id: '2',
        title: '初级会计',
        company: 'x',
        desc: '做账报税',
        source: 'current',
      },
      policy: { enabled: true, matchMode: 'llm_only', minMatchScore: 90 },
      llm: {
        suitable: true,
        score: 40,
        tier: 'weak',
        reasons: ['方向弱相关'],
        confidence: 0.5,
      },
    })
    expect(d.suitable).toBe(false)
    expect(d.score).toBe(40)
    expect(d.via).toBe('skip')
    expect(d.via).not.toBe('llm_error')
  })

  it('DEFAULT_MIN_MATCH_SCORE 仍为 50', () => {
    expect(DEFAULT_MIN_MATCH_SCORE).toBe(50)
  })


  it('decisionToMatchResult 省略 undefined score', () => {
    const d = decideJobMatch({
      profile,
      job: jobPm,
      policy: { enabled: true, matchMode: 'balanced' },
      llmError: 'Failed to fetch',
    })
    const m = decisionToMatchResult(d)
    expect(m.via).toBe('llm_error')
    expect(m.score).toBeUndefined()
    expect(m.suitable).toBe(false)
  })
})

describe('report matchLabel / matchReasonSummary — llm_error', () => {
  const baseJob = (over: Partial<JobRecord> = {}): JobRecord => ({
    id: 'j1',
    title: '项目经理',
    company: 'A',
    desc: 'x',
    source: 'current',
    firstSeenAt: 1,
    lastSeenAt: 1,
    ...over,
  })

  it('llm_error → LLM失败，不以「低分」开头', () => {
    const j = baseJob({
      match: {
        suitable: false,
        via: 'llm_error',
        reasons: ['LLM 失败：请求超时（45000ms）'],
        matchedAt: 1,
      },
      outcome: 'skipped',
    })
    const label = matchLabel(j)
    expect(label.text).toBe('LLM失败')
    expect(label.text).not.toMatch(/低分/)
    const summary = matchReasonSummary(j)
    expect(summary).toMatch(/^LLM失败/)
    expect(summary).not.toMatch(/^低分/)
  })

  it('真低分仍显示「低分 N」', () => {
    const j = baseJob({
      match: {
        suitable: false,
        via: 'skip',
        score: 30,
        reasons: ['综合分 30，阈值 50'],
        matchedAt: 1,
      },
    })
    expect(matchLabel(j).text).toBe('低分 30')
    expect(matchReasonSummary(j)).toMatch(/^低分 30/)
  })

  it('硬否仍显示「硬否」', () => {
    const j = baseJob({
      match: {
        suitable: false,
        via: 'hard_reject',
        score: 0,
        reasons: ['命中排除词：外包'],
        matchedAt: 1,
      },
    })
    expect(matchLabel(j).text).toBe('硬否')
    expect(matchReasonSummary(j)).toMatch(/^硬否/)
  })
})
