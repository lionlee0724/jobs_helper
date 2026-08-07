import type { DailyStats, EventRecord, JobRecord } from './types'
import { matchLabel, matchReasonSummary } from '../domain/match-display'

/** CSV 字段合同：职位 / 匹配 / 事件 / 日汇总（第一刀） */

export type ExportAllPayload = {
  exportedAt?: number
  jobs?: JobRecord[]
  events?: EventRecord[]
  daily_stats?: DailyStats[]
  threads?: unknown[]
  kv?: unknown
}

function csvEscape(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function row(cells: unknown[]): string {
  return cells.map(csvEscape).join(',')
}

function iso(ts?: number): string {
  if (ts == null || !Number.isFinite(ts)) return ''
  try {
    return new Date(ts).toISOString()
  } catch {
    return String(ts)
  }
}

function daySuitableRate(d: DailyStats): string {
  const denom = d.matchedSuitable + d.matchedUnsuitable
  if (denom <= 0) return ''
  return ((d.matchedSuitable / denom) * 100).toFixed(1)
}

/** 职位表：ID/标题/公司/薪资/城市/匹配结果/结果/理由… */
export function jobsToCsv(jobs: JobRecord[]): string {
  const header = row([
    'job_id',
    'title',
    'company',
    'salary',
    'city',
    'source',
    'first_seen_at',
    'last_seen_at',
    'match_suitable',
    'match_score',
    'match_via',
    'match_tier',
    'match_label',
    'match_reasons',
    'match_reason_summary',
    'match_model',
    'matched_at',
    'outcome',
    'open_chat_at',
  ])
  const lines = jobs.map((j) => {
    const m = j.match
    return row([
      j.id,
      j.title,
      j.company,
      j.salary ?? '',
      j.city ?? '',
      j.source,
      iso(j.firstSeenAt),
      iso(j.lastSeenAt),
      m?.suitable == null ? '' : m.suitable ? 'true' : 'false',
      m?.score ?? '',
      m?.via ?? '',
      m?.tier ?? '',
      matchLabel(j).text,
      (m?.reasons || []).join('；'),
      matchReasonSummary(j),
      m?.model ?? '',
      iso(m?.matchedAt),
      j.outcome ?? '',
      iso(j.openChatAt),
    ])
  })
  return [header, ...lines].join('\r\n')
}

/** 事件日志表 */
export function eventsToCsv(events: EventRecord[]): string {
  const header = row(['event_id', 'ts', 'day', 'type', 'job_id', 'thread_id', 'payload_json'])
  const lines = events.map((e) =>
    row([
      e.id,
      iso(e.ts),
      e.day,
      e.type,
      e.jobId ?? '',
      e.threadId ?? '',
      e.payload == null ? '' : JSON.stringify(e.payload),
    ]),
  )
  return [header, ...lines].join('\r\n')
}

/** 日汇总（含当日合适率） */
export function dailyStatsToCsv(daily: DailyStats[]): string {
  const header = row([
    'day',
    'seen',
    'matched_suitable',
    'matched_unsuitable',
    'suitable_rate_pct',
    'opened',
    'replies',
    'resumes_sent',
    'errors',
  ])
  const sorted = [...daily].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  const lines = sorted.map((d) =>
    row([
      d.day,
      d.seen,
      d.matchedSuitable,
      d.matchedUnsuitable,
      daySuitableRate(d),
      d.opened,
      d.replies,
      d.resumesSent,
      d.errors,
    ]),
  )
  return [header, ...lines].join('\r\n')
}

/**
 * 单文件多段 CSV（Excel 可直接打开；段标题以 # 开头）。
 * 字段顺序与合同一致：职位 → 事件 → 日汇总。
 */
export function buildExportCsv(payload: ExportAllPayload): string {
  const jobs = payload.jobs ?? []
  const events = payload.events ?? []
  const daily = payload.daily_stats ?? []
  const exportedAt = payload.exportedAt ? iso(payload.exportedAt) : iso(Date.now())
  const parts = [
    `# boss-job-assistant export`,
    `# exported_at,${csvEscape(exportedAt)}`,
    `# section,jobs,${jobs.length}`,
    jobsToCsv(jobs),
    '',
    `# section,events,${events.length}`,
    eventsToCsv(events),
    '',
    `# section,daily_stats,${daily.length}`,
    dailyStatsToCsv(daily),
    '',
  ]
  // Excel 友好 BOM
  return `\uFEFF${parts.join('\r\n')}`
}

/** 触发浏览器下载（UI 侧调用） */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = 'text/csv;charset=utf-8',
): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
