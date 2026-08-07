import { describe, expect, it } from 'vitest'
import {
  countKeywordHits,
  extractProfileKeywords,
  keywordMatchPasses,
} from '../../extension/domain/keyword-match'
import { decideJobMatch } from '../../extension/domain/match-decision'
import type { Job, Profile } from '../../extension/shared/types'

const profile: Profile = {
  syncedAt: 1,
  summary: '十年项目管理经验，熟悉销售管理与产业园区业务',
  skills: ['项目管理', '销售管理', '产业园', 'ToB'],
  highlights: ['带过销售团队', '熟悉川渝市场'],
  expectRoles: ['项目经理', '销售经理'],
}

const jobPm: Job = {
  id: '1',
  title: '产业工程高级销售经理',
  company: '某某',
  desc: '负责产业园项目拓展与销售管理，ToB 大客户，熟悉项目管理流程',
  source: 'current',
}

describe('extractProfileKeywords', () => {
  it('collects skills and highlights', () => {
    const kws = extractProfileKeywords(profile)
    expect(kws).toEqual(expect.arrayContaining(['项目管理', '销售管理', '产业园']))
  })
})

describe('countKeywordHits', () => {
  it('hits multiple keywords in job', () => {
    const r = countKeywordHits(profile, jobPm)
    expect(r.hitCount).toBeGreaterThanOrEqual(2)
    expect(r.hits.join('')).toMatch(/销售|项目|产业/)
  })
})

describe('keywordMatchPasses', () => {
  it('passes at threshold 2', () => {
    expect(keywordMatchPasses(profile, jobPm, 2).pass).toBe(true)
  })
})

describe('decideJobMatch balanced', () => {
  // 契约变更（2026-07）：关键词不再能「救回」LLM 的否定判断。
  // 旧行为（字面命中≥阈值即开聊）是「乱投」的直接成因，已按用户要求移除。
  it('LLM 判否时，关键词命中不再救回', () => {
    const d = decideJobMatch({
      profile,
      job: jobPm,
      policy: { enabled: true, matchMode: 'balanced', matchMinKeywordHits: 2 },
      llm: { suitable: false, reasons: ['方向不完全一致'], confidence: 0.8 },
    })
    expect(d.suitable).toBe(false)
    expect(d.score).toBeLessThan(55)
  })

  it('高分职位正常开聊', () => {
    const d = decideJobMatch({
      profile,
      job: jobPm,
      policy: { enabled: true, matchMode: 'balanced', matchMinKeywordHits: 2 },
      llm: { suitable: true, score: 82, tier: 'strong', reasons: ['核心职责重叠'], confidence: 0.8 },
    })
    expect(d.suitable).toBe(true)
    expect(['llm', 'hybrid']).toContain(d.via)
    expect(d.tier).toBe('strong')
  })

  it('中等分受阈值控制：提高阈值即不投', () => {
    const args = {
      profile,
      job: jobPm,
      llm: { suitable: true, score: 60, tier: 'moderate' as const, reasons: ['方向一致但行业不同'], confidence: 0.6 },
    }
    const low = decideJobMatch({
      ...args,
      policy: { enabled: true, matchMode: 'balanced', minMatchScore: 50 },
    })
    const high = decideJobMatch({
      ...args,
      policy: { enabled: true, matchMode: 'balanced', minMatchScore: 75 },
    })
    expect(low.suitable).toBe(true)
    expect(high.suitable).toBe(false)
  })

  it('LLM 未返回 score 时按其布尔判断折算，不当作「LLM 不可用」', () => {
    const d = decideJobMatch({
      profile,
      job: jobPm,
      policy: { enabled: true, matchMode: 'balanced' },
      llm: { suitable: false, reasons: ['不匹配'], confidence: 0.9 },
    })
    // 若错误地走了关键词兜底分支，via 会是 'keywords'
    expect(d.via).not.toBe('keywords')
    expect(d.suitable).toBe(false)
  })

  it('skips when neither path passes', () => {
    const d = decideJobMatch({
      profile,
      job: {
        id: '2',
        title: '初级会计',
        company: 'x',
        desc: '做账报税',
        source: 'current',
      },
      policy: { enabled: true, matchMode: 'balanced', matchMinKeywordHits: 2 },
      llm: { suitable: false, reasons: ['完全无关'], confidence: 0.9 },
    })
    expect(d.suitable).toBe(false)
  })
})
