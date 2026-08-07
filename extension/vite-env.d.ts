/**
 * Ambient types for Vite multi-entry query imports of suitable-rate-chart.
 * Keeps `?inline-sidepanel` / `?inline-report` suffixes for bundling while
 * satisfying `tsc --noEmit`.
 */
declare module '*?inline-sidepanel' {
  import type { DailyStats } from './shared/types'

  export type RatePoint = {
    day: string
    /** 0–1；无匹配样本时为 null（图上跳过连线断点） */
    rate: number | null
    suitable: number
    unsuitable: number
  }

  export function buildSuitableRatePoints(days: DailyStats[]): RatePoint[]

  export function drawSuitableRateChart(
    canvas: HTMLCanvasElement,
    days: DailyStats[],
    opts?: { emptyText?: string },
  ): void
}

declare module '*?inline-report' {
  import type { DailyStats } from './shared/types'

  export type RatePoint = {
    day: string
    /** 0–1；无匹配样本时为 null（图上跳过连线断点） */
    rate: number | null
    suitable: number
    unsuitable: number
  }

  export function buildSuitableRatePoints(days: DailyStats[]): RatePoint[]

  export function drawSuitableRateChart(
    canvas: HTMLCanvasElement,
    days: DailyStats[],
    opts?: { emptyText?: string },
  ): void
}
