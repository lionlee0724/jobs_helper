import type { DailyStats, EventRecord, JobSource } from '../../shared/types'
import { getDb, localDay } from '../db'

function emptyStats(day: string): DailyStats {
  return {
    day,
    seen: 0,
    matchedSuitable: 0,
    matchedUnsuitable: 0,
    opened: 0,
    replies: 0,
    resumesSent: 0,
    errors: 0,
    bySource: {},
  }
}

export async function getDaily(day = localDay()): Promise<DailyStats> {
  const row = await getDb().daily_stats.get(day)
  return row ?? emptyStats(day)
}

export async function bumpDailyFromEvent(ev: EventRecord): Promise<void> {
  const db = getDb()
  const day = ev.day
  const cur = (await db.daily_stats.get(day)) ?? emptyStats(day)

  switch (ev.type) {
    case 'job_seen':
      cur.seen += 1
      {
        const src = ev.payload?.source as JobSource | undefined
        if (src) {
          cur.bySource = cur.bySource ?? {}
          cur.bySource[src] = (cur.bySource[src] ?? 0) + 1
        }
      }
      break
    case 'job_matched':
      if (ev.payload?.suitable) cur.matchedSuitable += 1
      else cur.matchedUnsuitable += 1
      break
    case 'job_skipped':
      break
    case 'chat_open':
      cur.opened += 1
      break
    case 'chat_reply':
      cur.replies += 1
      break
    case 'resume_sent':
      cur.resumesSent += 1
      break
    case 'error':
    case 'captcha':
    case 'auth_lost':
      cur.errors += 1
      break
    default:
      break
  }

  await db.daily_stats.put(cur)
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