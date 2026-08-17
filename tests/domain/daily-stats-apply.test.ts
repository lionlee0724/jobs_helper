import { describe, it, expect } from 'vitest'
import { applyEventToStats } from '../../extension/data/repos/daily-stats'
import type { DailyStats, EventRecord } from '../../extension/shared/types'

const mk = (
  type: EventRecord['type'],
  payload?: Record<string, unknown>,
): EventRecord => ({
  id: 'e',
  ts: 1,
  day: '2026-08-14',
  type,
  payload,
})

const base = (): DailyStats => ({
  day: '2026-08-14',
  seen: 0,
  matchedSuitable: 0,
  matchedUnsuitable: 0,
  hardRejected: 0,
  opened: 0,
  replies: 0,
  resumesSent: 0,
  errors: 0,
  bySource: {},
})

describe('applyEventToStats（R1-6 日汇总对账：bump 与 recompute 共用规则）', () => {
  it('job_seen 累加 seen 与 bySource', () => {
    const s = base()
    applyEventToStats(s, mk('job_seen', { source: 'current' }))
    applyEventToStats(s, mk('job_seen', { source: 'current' }))
    expect(s.seen).toBe(2)
    expect(s.bySource?.current).toBe(2)
  })

  it('job_matched 按 suitable 分流，hard_reject 计 hardRejected', () => {
    const s = base()
    applyEventToStats(s, mk('job_matched', { suitable: true }))
    applyEventToStats(s, mk('job_matched', { suitable: false, via: 'hard_reject' }))
    applyEventToStats(s, mk('job_matched', { suitable: false, via: 'skip' }))
    expect(s.matchedSuitable).toBe(1)
    expect(s.matchedUnsuitable).toBe(2)
    expect(s.hardRejected).toBe(1)
  })

  it('chat_open / chat_reply / resume_sent 分别累加', () => {
    const s = base()
    applyEventToStats(s, mk('chat_open'))
    applyEventToStats(s, mk('chat_reply'))
    applyEventToStats(s, mk('resume_sent'))
    expect(s.opened).toBe(1)
    expect(s.replies).toBe(1)
    expect(s.resumesSent).toBe(1)
  })

  it('error / captcha / auth_lost 计入 errors', () => {
    const s = base()
    applyEventToStats(s, mk('error'))
    applyEventToStats(s, mk('captcha'))
    applyEventToStats(s, mk('auth_lost'))
    expect(s.errors).toBe(3)
  })

  it('job_skipped 与未知类型不改变统计', () => {
    const s = base()
    applyEventToStats(s, mk('job_skipped'))
    applyEventToStats(s, mk('tick' as EventRecord['type']))
    expect(s).toEqual(base())
  })

  it('对已有非零基数继续累加（增量 bump 语义）', () => {
    const s = base()
    s.seen = 10
    s.opened = 3
    applyEventToStats(s, mk('job_seen'))
    applyEventToStats(s, mk('chat_open'))
    expect(s.seen).toBe(11)
    expect(s.opened).toBe(4)
  })
})