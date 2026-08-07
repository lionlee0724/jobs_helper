import { describe, expect, it } from 'vitest'
import {
  originsCoverTarget,
  resolveChatCompletionsUrl,
  sanitizeHeaderValue,
} from '../../extension/background/llm-client'
import { preprocessResumeText, parseProfileAnalyze } from '../../extension/domain/profile-llm'

describe('resolveChatCompletionsUrl', () => {
  it('appends chat/completions for v1 base', () => {
    expect(resolveChatCompletionsUrl('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    )
  })

  it('keeps full path', () => {
    expect(
      resolveChatCompletionsUrl('https://api.deepseek.com/v1/chat/completions'),
    ).toBe('https://api.deepseek.com/v1/chat/completions')
  })

  it('resolves custom grok-like host', () => {
    expect(resolveChatCompletionsUrl('https://grok2api.lionlee.eu.cc/v1')).toBe(
      'https://grok2api.lionlee.eu.cc/v1/chat/completions',
    )
  })

  // 实际故障（2026-07）：粘贴的 base 带尾斜杠，再接 /v1 得到 `host//v1`，
  // 服务端当作不同路径返回 404，而错误信息里的 URL 肘一眼看上去是对的。
  it('collapses duplicate slashes in path', () => {
    expect(resolveChatCompletionsUrl('https://grok2api.lionlee.eu.cc//v1')).toBe(
      'https://grok2api.lionlee.eu.cc/v1/chat/completions',
    )
    expect(
      resolveChatCompletionsUrl('https://host.example.com//v1//chat//completions'),
    ).toBe('https://host.example.com/v1/chat/completions')
  })

  it('never collapses the protocol separator', () => {
    expect(resolveChatCompletionsUrl('https://api.deepseek.com/v1')).toMatch(
      /^https:\/\/api\.deepseek\.com\//,
    )
  })

  it('bare host gets /v1 (OpenAI 兼容惯例)', () => {
    expect(resolveChatCompletionsUrl('https://grok2api.lionlee.eu.cc')).toBe(
      'https://grok2api.lionlee.eu.cc/v1/chat/completions',
    )
    expect(resolveChatCompletionsUrl('https://grok2api.lionlee.eu.cc/')).toBe(
      'https://grok2api.lionlee.eu.cc/v1/chat/completions',
    )
  })

  it('无 scheme 时补 https 并保持路径正确', () => {
    expect(resolveChatCompletionsUrl('grok2api.lionlee.eu.cc//v1')).toBe(
      'https://grok2api.lionlee.eu.cc/v1/chat/completions',
    )
  })

  it('自定义版本段与非 /v1 路径', () => {
    expect(resolveChatCompletionsUrl('https://host.example.com/v2')).toBe(
      'https://host.example.com/v2/chat/completions',
    )
    expect(resolveChatCompletionsUrl('https://host.example.com/api')).toBe(
      'https://host.example.com/api/chat/completions',
    )
  })
})

describe('sanitizeHeaderValue', () => {
  it('strips zero-width and BOM', () => {
    expect(sanitizeHeaderValue('API Key', '﻿sk-abc​')).toBe('sk-abc')
  })

  it('strips wrapping quotes', () => {
    expect(sanitizeHeaderValue('API Key', '"sk-abc"')).toBe('sk-abc')
  })

  it('rejects CJK in header', () => {
    expect(() => sanitizeHeaderValue('API Key', '密钥sk-abc')).toThrow(/非法字符/)
  })
})

describe('originsCoverTarget', () => {
  const target = 'https://grok2api.lionlee.eu.cc/*'

  it('covers via <all_urls>', () => {
    expect(originsCoverTarget(['<all_urls>'], target)).toBe(true)
  })

  it('covers via https://*/*', () => {
    expect(originsCoverTarget(['https://*/*'], target)).toBe(true)
  })

  it('covers exact origin', () => {
    expect(originsCoverTarget([target], target)).toBe(true)
  })

  it('rejects unrelated host', () => {
    expect(originsCoverTarget(['https://api.deepseek.com/*'], target)).toBe(false)
  })
})

describe('profile preprocess + reject dump', () => {
  it('strips avatar noise', () => {
    const t = preprocessResumeText(
      '真实头像可以吸引更多招聘者，请使用白底 李某某 10年以上 智慧城市',
    )
    expect(t).not.toContain('真实头像')
    expect(t).toContain('智慧城市')
  })

  it('rejects summary that dumps raw', () => {
    const raw =
      '真实头像可以吸引更多招聘者，请使用白底或蓝底证件照凸显简历专业性编辑 李某某 10年以上经验本科离职'
    expect(() =>
      parseProfileAnalyze(
        JSON.stringify({
          summary: raw + raw,
          skills: ['项目管理'],
          highlights: ['千万项目'],
        }),
        raw,
      ),
    ).toThrow(/照抄|噪声/)
  })
})