import type { DailyStats, EventRecord, JobSource } from '../../shared/types'
import { getDb, localDay } from '../db'

function emptyStats(day: string): DailyStats {
  return {
    day,
    seen: 0,
    matchedSuitable: 0,
    matchedUnsuitable: 0,
    hardRejected: 0,
    opened: 0,
    replies: 0,
    resumesSent: 0,
    errors: 0,
    bySource: {},
  }
}

export async function getDaily(day = localDay()): Promise<DailyStats> {
  const row = await getDb().daily_stats.get(day)
  if (!row) return emptyStats(day)
  return {
    ...emptyStats(day),
    ...row,
    hardRejected: row.hardRejected ?? 0,
  }
}

/** 把一条事件累加到日汇总（纯函数：bump 与 recompute 共用同一套规则，R1-6） */
export function applyEventToStats(stats: DailyStats, ev: EventRecord): void {
  switch (ev.type) {
    case 'job_seen':
      stats.seen += 1
      {
        const src = ev.payload?.source as JobSource | undefined
        if (src) {
          stats.bySource = stats.bySource ?? {}
          stats.bySource[src] = (stats.bySource[src] ?? 0) + 1
        }
      }
      break
    case 'job_matched':
      if (ev.payload?.suitable) stats.matchedSuitable += 1
      else stats.matchedUnsuitable += 1
      if (ev.payload?.via === 'hard_reject') {
        stats.hardRejected = (stats.hardRejected ?? 0) + 1
      }
      break
    case 'job_skipped':
      break
    case 'chat_open':
      stats.opened += 1
      break
    case 'chat_reply':
      stats.replies += 1
      break
    case 'resume_sent':
      stats.resumesSent += 1
      break
    case 'error':
    case 'captcha':
    case 'auth_lost':
      stats.errors += 1
      break
    default:
      break
  }
}

export async function bumpDailyFromEvent(ev: EventRecord): Promise<void> {
  const db = getDb()
  const day = ev.day
  const cur = (await db.daily_stats.get(day)) ?? emptyStats(day)
  applyEventToStats(cur, ev)
  await db.daily_stats.put(cur)
}

function isAllZeroStats(s: DailyStats): boolean {
  return (
    s.seen === 0 &&
    s.matchedSuitable === 0 &&
    s.matchedUnsuitable === 0 &&
    (s.hardRejected ?? 0) === 0 &&
    s.opened === 0 &&
    s.replies === 0 &&
    s.resumesSent === 0 &&
    s.errors === 0
  )
}

/**
 * 按某天现存事件重建日汇总（删除事件后的对账工具，spec 4.4.4 / R1-6）。
 * 幂等：以事件表为唯一事实来源，先清空该日统计再全量累加；全 0 时删行。
 */
export async function recomputeDay(day: string): Promise<void> {
  const db = getDb()
  const events = await db.events.where('day').equals(day).toArray()
  const cur = emptyStats(day)
  for (const ev of events) applyEventToStats(cur, ev)
  if (isAllZeroStats(cur)) await db.daily_stats.delete(day)
  else await db.daily_stats.put(cur)
}

export async function recomputeDays(days: string[]): Promise<void> {
  const uniq = [...new Set(days.filter(Boolean))]
  await Promise.all(uniq.map((d) => recomputeDay(d)))
}

export async function listLastNDays(n: number): Promise<DailyStats[]> {
  const days: string[] = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    days.push(localDay(d.getTime()))
  }
  const rows = await Promise.all(days.map((day) => getDaily(day)))
  return rows
}