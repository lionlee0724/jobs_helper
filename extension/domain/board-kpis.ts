/** 看板开聊转化 KPI（纯函数） */
export type OpenChatKpis = {
  /** match.suitable === true 的职位数 */
  suitableCount: number
  openedCount: number
  openFailedCount: number
  /** opened / suitable；无 suitable 时 null */
  openSuccessRate: number | null
  /** openFailed / suitable；无 suitable 时 null */
  openFailRate: number | null
}

export type JobKpiInput = {
  match?: { suitable?: boolean } | null
  outcome?: string | null
}

export function computeOpenChatKpis(jobs: JobKpiInput[]): OpenChatKpis {
  let suitableCount = 0
  let openedCount = 0
  let openFailedCount = 0
  for (const j of jobs) {
    const suitable = j.match?.suitable === true
    if (suitable) suitableCount++
    if (j.outcome === 'opened') openedCount++
    if (suitable && j.outcome === 'failed') openFailedCount++
  }
  return {
    suitableCount,
    openedCount,
    openFailedCount,
    openSuccessRate:
      suitableCount > 0 ? openedCount / suitableCount : null,
    openFailRate: suitableCount > 0 ? openFailedCount / suitableCount : null,
  }
}

export function formatRatePct(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 100)}%`
}
