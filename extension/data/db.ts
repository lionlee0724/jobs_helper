import Dexie, { type Table } from 'dexie'
import type {
  ChatThread,
  DailyStats,
  EventRecord,
  JobRecord,
} from '../shared/types'

export class BossJobDb extends Dexie {
  jobs!: Table<JobRecord, string>
  events!: Table<EventRecord, string>
  chat_threads!: Table<ChatThread, string>
  daily_stats!: Table<DailyStats, string>

  constructor() {
    super('boss_job_assistant')
    this.version(1).stores({
      jobs: 'id, lastSeenAt, outcome, source, company',
      events: 'id, ts, day, type, jobId, [type+ts], [jobId+ts]',
      chat_threads: 'id, status, jobId, lastActionAt',
      daily_stats: 'day',
    })
  }
}

let _db: BossJobDb | null = null

export function getDb(): BossJobDb {
  if (!_db) _db = new BossJobDb()
  return _db
}

export function localDay(ts = Date.now()): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function newId(): string {
  return crypto.randomUUID()
}