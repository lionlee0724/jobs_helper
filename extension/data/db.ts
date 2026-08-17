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
    // v1：初始四表。历史版本保留只读记录；新库直接跳到 v2。
    this.version(1).stores({
      jobs: 'id, lastSeenAt, outcome, source, company',
      events: 'id, ts, day, type, jobId, [type+ts], [jobId+ts]',
      chat_threads: 'id, status, jobId, lastActionAt',
      daily_stats: 'day',
    })
    // v2：schema 未变，仅建立迁移脚手架（R1-5）——今后加索引/字段在 stores 中增量声明，
    // 并在 upgrade 回调做数据搬迁（如给旧行补默认值），避免「加字段=丢老库」。
    this.version(2)
      .stores({
        jobs: 'id, lastSeenAt, outcome, source, company',
        events: 'id, ts, day, type, jobId, [type+ts], [jobId+ts]',
        chat_threads: 'id, status, jobId, lastActionAt',
        daily_stats: 'day',
      })
      .upgrade(async () => {
        // v1→v2 无结构变化：占位回调，保证后续 v3+ 有清晰的升级点
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