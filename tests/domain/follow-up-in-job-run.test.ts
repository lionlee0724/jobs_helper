import { describe, expect, it } from 'vitest'
import { isFollowUpInJobRunEnabled } from '../../extension/domain/policy'

describe('isFollowUpInJobRunEnabled', () => {
  it('defaults off', () => {
    expect(isFollowUpInJobRunEnabled({ enabled: true })).toBe(false)
    expect(isFollowUpInJobRunEnabled({ enabled: true, followUpInJobRun: false })).toBe(false)
    expect(isFollowUpInJobRunEnabled({ enabled: true, followUpInJobRun: undefined })).toBe(false)
  })

  it('only true when explicitly enabled', () => {
    expect(isFollowUpInJobRunEnabled({ enabled: true, followUpInJobRun: true })).toBe(true)
  })
})
