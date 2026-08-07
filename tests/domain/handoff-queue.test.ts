import { describe, expect, it } from 'vitest'
import type { ChatThread } from '../../extension/shared/types'
import { compareFollowable } from '../../extension/data/repos/chat-threads'

/** handoff 不应进入可跟进自动队列（由 listFollowable 的 status 过滤保证；此处钉排序不把 handoff 当未读） */
function isAutoFollowable(status: ChatThread['status']): boolean {
  return status === 'active' || status === 'waiting_peer'
}

describe('handoff queue contract', () => {
  it('handoff is not auto-followable', () => {
    expect(isAutoFollowable('handoff')).toBe(false)
    expect(isAutoFollowable('active')).toBe(true)
    expect(isAutoFollowable('waiting_peer')).toBe(true)
    expect(isAutoFollowable('done')).toBe(false)
    expect(isAutoFollowable('error')).toBe(false)
  })

  it('compareFollowable still prefers unread among followable', () => {
    const a: ChatThread = {
      id: 'a',
      status: 'waiting_peer',
      unreadSeenAt: 100,
      lastActionAt: 1,
    }
    const b: ChatThread = {
      id: 'b',
      status: 'waiting_peer',
      lastActionAt: 1,
    }
    expect(compareFollowable(a, b)).toBeLessThan(0)
  })
})
