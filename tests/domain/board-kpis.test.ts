import { describe, expect, it } from 'vitest'
import {
  computeOpenChatKpis,
  formatRatePct,
} from '../../extension/domain/board-kpis'

describe('computeOpenChatKpis', () => {
  it('computes rates from suitable / opened / failed', () => {
    const k = computeOpenChatKpis([
      { match: { suitable: true }, outcome: 'opened' },
      { match: { suitable: true }, outcome: 'opened' },
      { match: { suitable: true }, outcome: 'failed' },
      { match: { suitable: false }, outcome: 'skipped' },
      { match: { suitable: true }, outcome: undefined },
    ])
    expect(k.suitableCount).toBe(4)
    expect(k.openedCount).toBe(2)
    expect(k.openFailedCount).toBe(1)
    expect(k.openSuccessRate).toBeCloseTo(0.5)
    expect(k.openFailRate).toBeCloseTo(0.25)
  })

  it('null rates when no suitable', () => {
    const k = computeOpenChatKpis([{ match: { suitable: false } }])
    expect(k.openSuccessRate).toBeNull()
    expect(formatRatePct(null)).toBe('—')
  })
})
