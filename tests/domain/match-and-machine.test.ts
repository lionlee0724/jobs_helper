import { describe, expect, it } from 'vitest'
import { parseMatchResult } from '../../extension/domain/match-llm'
import { parseChatReply } from '../../extension/domain/chat-llm'
import { decideJobMatch } from '../../extension/domain/match-decision'
import type { LlmMatchResult } from '../../extension/domain/match-llm'
import type { Job, Policy, Profile } from '../../extension/shared/types'

const profile: Profile = {
  syncedAt: 0,
  summary: '资深交付',
  skills: ['交付'],
  years: '10年',
}
const job: Job = {
  id: 'j1',
  title: '交付经理',
  company: 'C',
  desc: '负责项目交付',
  source: 'current',
}

describe('parseMatchResult', () => {
  it('parses plain json', () => {
    const r = parseMatchResult('{"suitable":true,"reasons":["技能匹配"],"confidence":0.8}')
    expect(r.suitable).toBe(true)
    expect(r.reasons[0]).toBe('技能匹配')
  })

  it('parses fenced-ish content', () => {
    const r = parseMatchResult('结果如下\n{"suitable":false,"reasons":["城市不符"]}\n')
    expect(r.suitable).toBe(false)
  })

  it('malformed JSON 抛错（fail-fast，不产生假分）', () => {
    expect(() => parseMatchResult('不是 JSON')).toThrow(/无法解析/)
    expect(() => parseMatchResult('{"suitable": true')).toThrow(/无法解析/)
  })

  it('分数被钳制在 0-100', () => {
    expect(parseMatchResult('{"score": 500}').score).toBe(100)
    expect(parseMatchResult('{"score": -3}').score).toBe(0)
  })

  it('分数与 tier 冲突时以分数为准', () => {
    const r = parseMatchResult('{"score": 20, "tier": "strong"}')
    expect(r.tier).toBe('reject')
    expect(r.suitable).toBe(false)
  })
})

describe('parseChatReply', () => {
  it('parses text field', () => {
    expect(parseChatReply('{"text":"好的，我方便面试"}')).toBe('好的，我方便面试')
  })
})

describe('decideJobMatch — llm_only 模式边界（审计 3.2 补漏）', () => {
  const policy: Policy = { enabled: true, matchMode: 'llm_only', minMatchScore: 50 }

  it('高分 → suitable / via llm', () => {
    const llm: LlmMatchResult = {
      suitable: true,
      score: 80,
      tier: 'strong',
      reasons: ['高度匹配'],
      confidence: 0.9,
    }
    const d = decideJobMatch({ profile, job, policy, llm })
    expect(d.score).toBe(80)
    expect(d.suitable).toBe(true)
    expect(d.via).toBe('llm')
  })

  it('低分 → skip（不因关键词命中误投）', () => {
    const llm: LlmMatchResult = {
      suitable: false,
      score: 30,
      tier: 'reject',
      reasons: ['匹配度低'],
      confidence: 0.8,
    }
    const d = decideJobMatch({ profile, job, policy, llm })
    expect(d.suitable).toBe(false)
    expect(d.via).toBe('skip')
    expect(d.score).toBe(30)
  })

  it('无 LLM 结果且无错误 → skip，score 为 0 但不冒充评过分', () => {
    const d = decideJobMatch({ profile, job, policy, llm: null })
    expect(d.via).toBe('skip')
    expect(d.score).toBe(0)
  })

  it('LLM 异常 → llm_error（省略 score，禁止 0 分冒充）', () => {
    const d = decideJobMatch({ profile, job, policy, llm: null, llmError: 'LLM HTTP 429 @ x' })
    expect(d.via).toBe('llm_error')
    expect(d.score).toBeUndefined()
  })
})