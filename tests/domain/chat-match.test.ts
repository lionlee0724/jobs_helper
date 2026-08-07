import { describe, expect, it } from 'vitest'
import {
  CHAT_MATCH_THRESHOLD,
  fingerprintPeer,
  normalizeMatchText,
  pickBestSession,
  scoreChatSessionMatch,
} from '../../extension/domain/chat-match'

describe('normalizeMatchText', () => {
  it('lowercases and strips company suffix', () => {
    expect(normalizeMatchText('  阿里巴巴有限公司 ')).toBe('阿里巴巴')
  })
})

describe('scoreChatSessionMatch / pickBestSession', () => {
  const sessions = [
    { key: '1', title: '前端工程师', company: '字节跳动' },
    { key: '2', title: '项目经理', company: '某某科技有限公司' },
    { key: '3', title: '产品经理 · 某不知名', company: '无关公司' },
  ]

  it('picks high-confidence company+title match', () => {
    const r = pickBestSession(
      { company: '某某科技', jobTitle: '项目经理' },
      sessions,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.session.key).toBe('2')
      expect(r.score).toBeGreaterThanOrEqual(CHAT_MATCH_THRESHOLD)
    }
  })

  it('fails S1 when no strong match', () => {
    const r = pickBestSession(
      { company: '完全不存在的公司XYZ', jobTitle: '量子力学工程师' },
      sessions,
    )
    expect(r.ok).toBe(false)
  })

  it('scores exact company high', () => {
    const sc = scoreChatSessionMatch(
      { company: '字节跳动', jobTitle: '前端工程师' },
      sessions[0],
    )
    expect(sc).toBeGreaterThanOrEqual(CHAT_MATCH_THRESHOLD)
  })
})

describe('fingerprintPeer', () => {
  it('collapses whitespace and truncates', () => {
    expect(fingerprintPeer('  hello   world  ')).toBe('hello world')
    expect(fingerprintPeer('a'.repeat(300)).length).toBe(200)
  })

  it('same text same fingerprint', () => {
    expect(fingerprintPeer('发一下简历')).toBe(fingerprintPeer('发一下简历'))
  })
})
