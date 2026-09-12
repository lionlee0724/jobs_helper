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
  const text = styles.getPropertyValue('--text').trim() || '#ffffff'
  const muted = styles.getPropertyValue('--muted').trim() || '#8e8e93'
  const border = styles.getPropertyValue('--border').trim() || 'rgba(255, 255, 255, 0.1)'
  const accent = styles.getPropertyValue('--accent').trim() || '#0a84ff'
  const panel = styles.getPropertyValue('--input-bg').trim() || 'transparent'

  if (panel && panel !== 'transparent') {
    ctx.fillStyle = panel
    ctx.fillRect(0, 0, cssW, cssH)
  }

  const padL = 38
  const padR = 14
  const padT = 16
  const padB = 26
  const plotW = cssW - padL - padR
  const plotH = cssH - padT - padB

  // Y 网格与刻度 0 / 50 / 100%
  ctx.font = '10px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const pct of [0, 50, 100]) {
    const y = padT + plotH - (pct / 100) * plotH
    ctx.strokeStyle = border
    ctx.lineWidth = 0.75
    ctx.setLineDash(pct === 0 ? [] : [3, 3])
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + plotW, y)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = muted
    ctx.fillText(`${pct}%`, padL - 6, y)
  }

  if (!points.length) {
    ctx.fillStyle = muted
    ctx.font = '11.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(opts?.emptyText || '暂无近7日数据', cssW / 2, cssH / 2)
    return
  }

  const n = points.length
  const xAt = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const yAt = (rate: number) => padT + plotH - rate * plotH

  // 1. 区域渐变填充 (Apple Area Fill)
  const validIndices = points
    .map((p, idx) => (p.rate != null ? idx : -1))
    .filter((idx) => idx >= 0)

  if (validIndices.length > 1) {
    const fillGrad = ctx.createLinearGradient(0, padT, 0, padT + plotH)
    fillGrad.addColorStop(0, accent.startsWith('#') ? `${accent}40` : 'rgba(10, 132, 255, 0.25)')
    fillGrad.addColorStop(1, 'rgba(10, 132, 255, 0.0)')

    ctx.fillStyle = fillGrad
    ctx.beginPath()
    let firstX = xAt(validIndices[0])
    let lastX = xAt(validIndices[validIndices.length - 1])

    ctx.moveTo(firstX, padT + plotH)
    for (const idx of validIndices) {
      ctx.lineTo(xAt(idx), yAt(points[idx].rate!))
    }
    ctx.lineTo(lastX, padT + plotH)
    ctx.closePath()
    ctx.fill()
  }

  // 2. 曲线连线
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.5
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

  // 3. 点与标签 (Apple Glowing Ring Dots)
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

    // 外光晕/外圈
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()

    // 内白芯
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, 2, 0, Math.PI * 2)
    ctx.fill()

    // 标签
    ctx.fillStyle = text
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`${Math.round(p.rate * 100)}%`, x, y - 6)
  }

  // 4. X 轴日期标签
  ctx.fillStyle = muted
  ctx.font = '10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let i = 0; i < n; i++) {
    ctx.fillText(shortDay(points[i].day), xAt(i), padT + plotH + 7)
  }
}
