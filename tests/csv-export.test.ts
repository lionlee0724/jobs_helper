import { describe, expect, it } from 'vitest'
import {
  buildExportCsv,
  dailyStatsToCsv,
  eventsToCsv,
  jobsToCsv,
} from '../extension/shared/csv-export'
import type { DailyStats, EventRecord, JobRecord } from '../extension/shared/types'

const sampleJob: JobRecord = {
  id: 'j1',
  title: '前端, 工程师',
  company: 'Acme "Co"',
  salary: '20-30K',
  city: '上海',
  desc: 'desc',
  source: 'current',
  firstSeenAt: 1_700_000_000_000,
  lastSeenAt: 1_700_000_100_000,
  match: {
    suitable: true,
    score: 80,
    via: 'hybrid',
    reasons: ['技能匹配', '城市合适'],
    matchedAt: 1_700_000_050_000,
    model: 'test-model',
  },
  outcome: 'opened',
  openChatAt: 1_700_000_080_000,
}

const sampleEvent: EventRecord = {
  id: 'e1',
  ts: 1_700_000_000_000,
  day: '2023-11-14',
  type: 'job_matched',
  jobId: 'j1',
  payload: { suitable: true },
}

const sampleDay: DailyStats = {
  day: '2023-11-14',
  seen: 10,
  matchedSuitable: 3,
  matchedUnsuitable: 1,
  opened: 2,
  replies: 1,
  resumesSent: 0,
  errors: 0,
}

describe('csv-export', () => {
  it('escapes commas and quotes in job fields', () => {
    const csv = jobsToCsv([sampleJob])
    expect(csv).toContain('"前端, 工程师"')
    expect(csv).toContain('"Acme ""Co"""')
    expect(csv).toContain('job_id,title,company')
    expect(csv).toContain('j1')
    expect(csv).toContain('true')
    expect(csv).toContain('80')
    expect(csv).toContain('hybrid')
  })

  it('writes event payload as json', () => {
    const csv = eventsToCsv([sampleEvent])
    expect(csv).toContain('event_id,ts,day,type')
    expect(csv).toContain('job_matched')
    // JSON 内双引号按 CSV 规则翻倍
    expect(csv).toContain('""suitable"":true')
  })

  it('computes daily suitable rate percent', () => {
    const csv = dailyStatsToCsv([sampleDay])
    expect(csv).toContain('75.0') // 3/4
  })

  it('buildExportCsv includes three sections and BOM', () => {
    const text = buildExportCsv({
      exportedAt: 1_700_000_000_000,
      jobs: [sampleJob],
      events: [sampleEvent],
      daily_stats: [sampleDay],
    })
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text).toContain('# section,jobs,1')
    expect(text).toContain('# section,events,1')
    expect(text).toContain('# section,daily_stats,1')
  })
})
