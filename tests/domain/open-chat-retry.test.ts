import { describe, expect, it } from 'vitest'
import {
  filterOpenChatRetryCandidates,
  isOpenChatRetryCandidate,
} from '../../extension/domain/open-chat-retry'

describe('open-chat retry candidates', () => {
  it('only suitable+failed', () => {
    expect(
      isOpenChatRetryCandidate({
        match: { suitable: true, reasons: [], matchedAt: 1 },
        outcome: 'failed',
      }),
    ).toBe(true)
    expect(
      isOpenChatRetryCandidate({
        match: { suitable: true, reasons: [], matchedAt: 1 },
        outcome: 'opened',
      }),
    ).toBe(false)
    expect(
      isOpenChatRetryCandidate({
        match: { suitable: false, reasons: [], matchedAt: 1 },
        outcome: 'failed',
      }),
    ).toBe(false)
  })

  it('filters list', () => {
    const rows = filterOpenChatRetryCandidates([
      { match: { suitable: true, reasons: [], matchedAt: 1 }, outcome: 'failed' },
      { match: { suitable: true, reasons: [], matchedAt: 1 }, outcome: 'opened' },
    ])
    expect(rows).toHaveLength(1)
  })
})
