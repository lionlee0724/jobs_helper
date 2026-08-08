import { describe, expect, it } from 'vitest'
import { buildSuitableRatePoints } from '../extension/ui/shared/suitable-rate-chart'
import type { DailyStats } from '../extension/shared/types'

describe('buildSuitableRatePoints', () => {
  it('sorts old→new and computes rate without inventing scores', () => {
    const days: DailyStats[] = [
      {
        day: '2026-08-03',
        seen: 5,
        matchedSuitable: 2,
        matchedUnsuitable: 2,
        hardRejected: 0,
        opened: 1,
        replies: 0,
        resumesSent: 0,
        errors: 0,
      },
      {
        day: '2026-08-01',
        seen: 3,
        matchedSuitable: 1,
        matchedUnsuitable: 0,
        hardRejected: 0,
        opened: 0,
        replies: 0,
        resumesSent: 0,
        errors: 0,
      },
      {
        day: '2026-08-02',
        seen: 0,
        matchedSuitable: 0,
        matchedUnsuitable: 0,
        hardRejected: 0,
        opened: 0,
        replies: 0,
        resumesSent: 0,
        errors: 0,
      },
    ]
    const pts = buildSuitableRatePoints(days)
    expect(pts.map((p) => p.day)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
    expect(pts[0].rate).toBe(1)
    expect(pts[1].rate).toBeNull()
    expect(pts[2].rate).toBe(0.5)
  })
})
