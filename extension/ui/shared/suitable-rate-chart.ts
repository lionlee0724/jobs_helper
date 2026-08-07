import type { DailyStats } from '../../shared/types'

export type RatePoint = {
  day: string
  /** 0–1；无匹配样本时为 null（图上跳过连线断点） */
  rate: number | null
  suitable: number
  unsuitable: number
}

/** 由日汇总生成近 N 日合适率点（时间从旧→新，只读、不重算匹配） */
export function buildSuitableRatePoints(days: DailyStats[]): RatePoint[] {
  const sorted = [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return sorted.map((d) => {
    const suitable = d.matchedSuitable || 0
    const unsuitable = d.matchedUnsuitable || 0
    const denom = suitable + unsuitable
    return {
      day: d.day,
      rate: denom <= 0 ? null : suitable / denom,
      suitable,
      unsuitable,
    }
  })
}

function shortDay(day: string): string {
  // YYYY-MM-DD → MM-DD
  const m = day.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[2]}-${m[3]}`
  return day.slice(-5)
}

/**
 * 零依赖 canvas 折线图：近 N 日合适率（只读展示）。
 * 无数据时画占位文案。
 */
export function drawSuitableRateChart(
  canvas: HTMLCanvasElement,
  days: DailyStats[],
  opts?: { emptyText?: string },
): void {
  const points = buildSuitableRatePoints(days)
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
  const cssW = canvas.clientWidth || 320
  const cssH = canvas.clientHeight || 140
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const styles = getComputedStyle(document.documentElement)
  const text = styles.getPropertyValue('--text').trim() || '#e7ecf3'
  const muted = styles.getPropertyValue('--muted').trim() || '#8b9bb4'
  const border = styles.getPropertyValue('--border').trim() || '#2a3548'
  const accent = styles.getPropertyValue('--accent').trim() || '#3b82f6'
  const panel = styles.getPropertyValue('--bg').trim() || '#0f1419'

  ctx.fillStyle = panel
  ctx.fillRect(0, 0, cssW, cssH)

  const padL = 36
  const padR = 10
  const padT = 12
  const padB = 28
  const plotW = cssW - padL - padR
  const plotH = cssH - padT - padB

  // 坐标轴
  ctx.strokeStyle = border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, padT)
  ctx.lineTo(padL, padT + plotH)
  ctx.lineTo(padL + plotW, padT + plotH)
  ctx.stroke()

  // Y 网格 0/50/100%
  ctx.fillStyle = muted
  ctx.font = '10px system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const pct of [0, 50, 100]) {
    const y = padT + plotH - (pct / 100) * plotH
    ctx.strokeStyle = border
    ctx.globalAlpha = 0.45
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + plotW, y)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.fillStyle = muted
    ctx.fillText(`${pct}%`, padL - 4, y)
  }

  if (!points.length) {
    ctx.fillStyle = muted
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(opts?.emptyText || '暂无近7日数据', cssW / 2, cssH / 2)
    return
  }

  const n = points.length
  const xAt = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const yAt = (rate: number) => padT + plotH - rate * plotH

  // 折线（null 断点）
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  let drawing = false
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const p = points[i]
    if (p.rate == null) {
      drawing = false
      continue
    }
    const x = xAt(i)
    const y = yAt(p.rate)
    if (!drawing) {
      ctx.moveTo(x, y)
      drawing = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()

  // 点
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const x = xAt(i)
    if (p.rate == null) {
      ctx.fillStyle = muted
      ctx.beginPath()
      ctx.arc(x, padT + plotH, 2.5, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    const y = yAt(p.rate)
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(x, y, 3.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = text
    ctx.font = '9px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`${Math.round(p.rate * 100)}%`, x, y - 5)
  }

  // X 标签
  ctx.fillStyle = muted
  ctx.font = '10px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let i = 0; i < n; i++) {
    ctx.fillText(shortDay(points[i].day), xAt(i), padT + plotH + 6)
  }
}
