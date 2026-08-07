import type { AnalyticsSummary } from '../shared/types'
import { getDaily, listLastNDays } from './repos/daily-stats'

export async function summaryTodayAndWeek(): Promise<AnalyticsSummary> {
  const today = await getDaily()
  const last7 = await listLastNDays(7)
  const suitable = last7.reduce((s, d) => s + d.matchedSuitable, 0)
  const unsuitable = last7.reduce((s, d) => s + d.matchedUnsuitable, 0)
  const denom = suitable + unsuitable
  return {
    today,
    last7,
    suitableRate: denom === 0 ? null : suitable / denom,
  }
}