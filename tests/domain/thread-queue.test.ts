import { describe, it, expect } from 'vitest'
import {
  compareFollowable,
  importedThreadId,
} from '../../extension/data/repos/chat-threads'
import type { ChatThread } from '../../extension/shared/types'

const t = (over: Partial<ChatThread>): ChatThread => ({
  id: over.id || 'x',
  status: 'waiting_peer',
  ...over,
})

describe('compareFollowable — 未读优先', () => {
  it('有未读的排在无未读之前', () => {
    const unread = t({ id: 'a', unreadSeenAt: 1000, lastActionAt: 9999 })
    const read = t({ id: 'b', lastActionAt: 1 })
    expect([read, unread].sort(compareFollowable)[0].id).toBe('a')
  })

  it('都有未读时，最近扫到的优先', () => {
    const older = t({ id: 'a', unreadSeenAt: 100 })
    const newer = t({ id: 'b', unreadSeenAt: 200 })
    expect([older, newer].sort(compareFollowable)[0].id).toBe('b')
  })

  it('都无未读时，久未跟进的优先', () => {
    const recent = t({ id: 'a', lastActionAt: 900 })
    const stale = t({ id: 'b', lastActionAt: 100 })
    expect([recent, stale].sort(compareFollowable)[0].id).toBe('b')
  })

  it('缺字段不会导致排序异常', () => {
    const rows = [t({ id: 'a' }), t({ id: 'b', lastActionAt: 5 }), t({ id: 'c', unreadSeenAt: 1 })]
    const sorted = [...rows].sort(compareFollowable)
    expect(sorted[0].id).toBe('c')
    expect(sorted).toHaveLength(3)
  })
})

describe('importedThreadId — 稳定身份', () => {
  it('同一公司+职位得到同一 ID（避免重复导入）', () => {
    const a = importedThreadId({ title: '项目经理', company: '某某科技' })
    const b = importedThreadId({ title: ' 项目经理 ', company: '某某科技' })
    expect(a).toBe(b)
  })

  it('不含列表行序号——列表重排后 ID 不变', () => {
    const id = importedThreadId({ title: '项目经理', company: '某某科技' })
    expect(id).not.toMatch(/\|\d+$/)
    expect(id.startsWith('chat:')).toBe(true)
  })

  it('不同职位得到不同 ID', () => {
    expect(importedThreadId({ title: '项目经理', company: 'A' })).not.toBe(
      importedThreadId({ title: '产品经理', company: 'A' }),
    )
  })

  it('缺公司时仍可生成', () => {
    expect(importedThreadId({ title: '项目经理' })).toBe('chat:|项目经理')
  })
})
