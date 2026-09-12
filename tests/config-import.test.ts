import { describe, it, expect } from 'vitest'
import {
  isMaskedApiKey,
  mergeLlmForImport,
  parseConfigImport,
} from '../extension/shared/config-import'

describe('parseConfigImport', () => {
  it('解析完整 export/all 载荷中的 kv', () => {
    const r = parseConfigImport({
      exportedAt: 1_700_000_000_000,
      jobs: [],
      kv: {
        policy: { enabled: true, minMatchScore: 45, riskProfile: 'balanced' },
        llm: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '***', model: 'deepseek-chat' },
        profile: {
          syncedAt: 1,
          summary: '十年项目管理与交付，聚焦智慧城市。',
          skills: ['项目管理', '交付'],
          years: '10年',
        },
        messageAssist: { enabled: true, autonomy: 'graded', batchSize: 8 },
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.exportedAt).toBe(1_700_000_000_000)
    expect(r.config.policy?.enabled).toBe(true)
    expect(r.config.policy?.minMatchScore).toBe(45)
    expect(r.config.llm?.model).toBe('deepseek-chat')
    expect(r.config.llm?.apiKey).toBe('***')
    expect(r.config.profile?.skills).toContain('项目管理')
    expect(r.config.messageAssist?.batchSize).toBe(8)
    expect(r.summary).toMatch(/策略/)
    expect(r.warnings.some((w) => /API Key/.test(w))).toBe(true)
  })

  it('支持仅配置对象（无 jobs 外壳）', () => {
    const r = parseConfigImport({
      policy: { enabled: false },
      llm: { baseUrl: 'https://x', apiKey: 'sk-live', model: 'm' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.policy?.enabled).toBe(false)
    expect(r.config.llm?.apiKey).toBe('sk-live')
    expect(r.warnings.length).toBe(0)
  })

  it('拒绝无配置字段的文件', () => {
    const r = parseConfigImport({ jobs: [], events: [] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/未识别|没有可导入/)
  })

  it('JSON 字符串非法 → 失败', () => {
    const r = parseConfigImport('{not-json')
    expect(r.ok).toBe(false)
  })

  it('空画像跳过 profile', () => {
    const r = parseConfigImport({
      kv: {
        policy: { enabled: true },
        profile: { syncedAt: 1, summary: '', skills: [] },
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.profile).toBeUndefined()
    expect(r.config.policy).toBeDefined()
  })
})

describe('mergeLlmForImport / isMaskedApiKey', () => {
  it('识别掩码 Key', () => {
    expect(isMaskedApiKey('***')).toBe(true)
    expect(isMaskedApiKey('****')).toBe(true)
    expect(isMaskedApiKey('sk-real')).toBe(false)
  })

  it('掩码 Key 保留本机', () => {
    const merged = mergeLlmForImport(
      { baseUrl: 'https://new', apiKey: '***', model: 'new-model' },
      { baseUrl: 'https://old', apiKey: 'sk-keep', model: 'old-model' },
    )
    expect(merged?.apiKey).toBe('sk-keep')
    expect(merged?.baseUrl).toBe('https://new')
    expect(merged?.model).toBe('new-model')
  })

  it('真实 Key 覆盖', () => {
    const merged = mergeLlmForImport(
      { baseUrl: 'https://new', apiKey: 'sk-new', model: 'm' },
      { baseUrl: 'https://old', apiKey: 'sk-old', model: 'o' },
    )
    expect(merged?.apiKey).toBe('sk-new')
  })
})
