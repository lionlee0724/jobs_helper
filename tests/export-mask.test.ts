import { describe, it, expect } from 'vitest'
import { maskKvForExport } from '../extension/shared/export-mask'

describe('maskKvForExport（R1-1 导出脱敏）', () => {
  it('非空 apiKey 掩码为 ***，其余字段保留', () => {
    const out = maskKvForExport({
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-secret-123', model: 'gpt-4o' },
    })
    expect(out.llm?.apiKey).toBe('***')
    expect(out.llm?.baseUrl).toBe('https://x/v1')
    expect(out.llm?.model).toBe('gpt-4o')
  })

  it('空 apiKey 保持空串（不伪造 ***）', () => {
    const out = maskKvForExport({ llm: { baseUrl: '', apiKey: '', model: '' } })
    expect(out.llm?.apiKey).toBe('')
  })

  it('无 llm 字段时原对象原样返回', () => {
    const kv = { policy: { enabled: false } }
    expect(maskKvForExport(kv)).toBe(kv)
  })

  it('其它 KV 字段透传不受影响', () => {
    const out = maskKvForExport({
      llm: { baseUrl: 'b', apiKey: 'k', model: 'm' },
      profile: { summary: 's' },
    })
    expect(out.profile).toEqual({ summary: 's' })
  })
})