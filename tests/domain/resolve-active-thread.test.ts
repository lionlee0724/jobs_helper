import { describe, expect, it } from 'vitest'
import {
  activeContextIsUsable,
  pickBestThreadForActiveContext,
  scoreThreadAgainstActiveContext,
} from '../../extension/domain/resolve-active-thread'
import { importedThreadId } from '../../extension/data/repos/chat-threads'
import type { ChatThread } from '../../extension/shared/types'
import { CHAT_MATCH_THRESHOLD } from '../../extension/domain/chat-match'

const thread = (over: Partial<ChatThread>): ChatThread => ({
  id: over.id || 't1',
  status: 'waiting_peer',
  ...over,
})

describe('activeContextIsUsable', () => {
  it('accepts title or company', () => {
    expect(activeContextIsUsable({ title: '项目经理', blob: '' })).toBe(true)
    expect(activeContextIsUsable({ company: '某某科技', blob: '' })).toBe(true)
  })

  it('rejects empty / noise', () => {
    expect(activeContextIsUsable({ blob: '' })).toBe(false)
    expect(activeContextIsUsable({ blob: '消息' })).toBe(false)
  })
})

describe('pickBestThreadForActiveContext', () => {
  const threads = [
    thread({
      id: 'job:1',
      company: '字节跳动',
      jobTitle: '前端工程师',
      source: 'self',
    }),
    thread({
      id: 'job:2',
      company: '某某科技',
      jobTitle: '项目经理',
      source: 'self',
    }),
  ]

  it('hits existing thread above threshold', () => {
    const hit = pickBestThreadForActiveContext(
      { title: '项目经理', company: '某某科技', blob: '肖女士 某某科技 | 项目经理' },
      threads,
    )
    expect(hit).not.toBeNull()
    expect(hit!.thread.id).toBe('job:2')
    expect(hit!.score).toBeGreaterThanOrEqual(CHAT_MATCH_THRESHOLD)
  })

  it('returns null when no match', () => {
    const hit = pickBestThreadForActiveContext(
      {
        title: '量子力学',
        company: '完全不存在XYZ',
        blob: '完全不存在XYZ | 量子力学',
      },
      threads,
    )
    expect(hit).toBeNull()
  })

  it('scores higher when company+title align', () => {
    const sc = scoreThreadAgainstActiveContext(
      { title: '前端工程师', company: '字节跳动', blob: '字节跳动 前端工程师' },
      threads[0],
    )
    expect(sc).toBeGreaterThanOrEqual(CHAT_MATCH_THRESHOLD)
  })
})

describe('current_ui stable id', () => {
  it('reuses importedThreadId shape for new current_ui threads', () => {
    const id = importedThreadId({ title: '猎头顾问', company: '优途' })
    expect(id.startsWith('chat:')).toBe(true)
    expect(id).toBe(importedThreadId({ title: ' 猎头顾问 ', company: '优途' }))
  })
})
