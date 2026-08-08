import { describe, expect, it } from 'vitest'
import { isFollowUpInJobRunEnabled } from '../../extension/domain/policy'

describe('isFollowUpInJobRunEnabled', () => {
  it('defaults on (Spec interleaved follow-up)', () => {
    expect(isFollowUpInJobRunEnabled({ enabled: true })).toBe(true)
    expect(isFollowUpInJobRunEnabled({ enabled: true, followUpInJobRun: undefined })).toBe(true)
  })

  it('only false when explicitly disabled', () => {
    expect(isFollowUpInJobRunEnabled({ enabled: true, followUpInJobRun: false })).toBe(false)
    expect(isFollowUpInJobRunEnabled({ enabled: true, followUpInJobRun: true })).toBe(true)
  })
})
