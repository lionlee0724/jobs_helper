import { describe, it, expect } from 'vitest'
import { decideJobMatch } from '../../extension/domain/match-decision'
import type { LlmMatchResult } from '../../extension/domain/match-llm'
import type { Job, Policy, Profile } from '../../extension/shared/types'

// 简历含 5 个技能词，职位标题+描述全部命中 → keywordScore 饱和到封顶 60
const profile: Profile = {
  syncedAt: 0,
  summary: '资深交付专家',
  skills: ['项目管理', '交付', '数据分析', '售前', '方案'],
  years: '10年',
}
const job: Job = {
  id: 'j1',
  title: '项目经理',
  company: '某公司',
  desc: '项目管理 交付 数据分析 售前 方案',
  source: 'current',
}

describe('关键词单通道封顶 60（审计合同锁死，08-08 薄切片）', () => {
  it('keywords_only：全命中时综合分恰为 60，不随命中数继续上涨', () => {
    const policy: Policy = {
      enabled: true,
      matchMode: 'keywords_only',
      matchMinKeywordHits: 3,
      minMatchScore: 50,
    }
    const d = decideJobMatch({ profile, job, policy })
    expect(d.score).toBe(60)
    expect(d.suitable).toBe(true)
  })

  it('balanced 无 LLM 兜底：关键词满命中也只能到 60（无法冒充高档）', () => {
    const policy: Policy = { enabled: true, matchMode: 'balanced', minMatchScore: 50 }
    const d = decideJobMatch({ profile, job, policy, llm: null })
    expect(d.score).toBe(60)
    expect(d.via).toBe('keywords')
    expect(d.confidence).toBe(0.3)
  })

  it('balanced 混合：关键词贡献被 0.25 权重稀释，低分 LLM 不能被救回', () => {
    const policy: Policy = {
      enabled: true,
      matchMode: 'balanced',
      minMatchScore: 50,
      matchLlmWeight: 0.75,
    }
    const llmLow: LlmMatchResult = {
      suitable: false,
      score: 20,
      tier: 'reject',
      reasons: ['技能与职位匹配度低'],
      confidence: 0.9,
    }
    const d = decideJobMatch({ profile, job, policy, llm: llmLow })
    // 20×0.75 + 60×0.25 = 30：封顶的关键词分也无法把 30 抬过 50
    expect(d.score).toBe(30)
    expect(d.suitable).toBe(false)
    expect(d.via).toBe('hybrid')
  })

  it('balanced 高分 LLM + 满关键词：综合分按权重合成', () => {
    const policy: Policy = {
      enabled: true,
      matchMode: 'balanced',
      minMatchScore: 50,
      matchLlmWeight: 0.75,
    }
    const llmHigh: LlmMatchResult = {
      suitable: true,
      score: 88,
      tier: 'strong',
      reasons: ['高度匹配'],
      confidence: 0.95,
    }
    const d = decideJobMatch({ profile, job, policy, llm: llmHigh })
    expect(d.score).toBe(Math.round(88 * 0.75 + 60 * 0.25))
    expect(d.suitable).toBe(true)
  })
})