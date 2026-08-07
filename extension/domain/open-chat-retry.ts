import type { JobRecord } from '../shared/types'

/** 匹配合适但开聊失败 → 可重试 */
export function isOpenChatRetryCandidate(
  j: Pick<JobRecord, 'match' | 'outcome'>,
): boolean {
  return j.match?.suitable === true && j.outcome === 'failed'
}

export function filterOpenChatRetryCandidates<T extends Pick<JobRecord, 'match' | 'outcome'>>(
  jobs: T[],
): T[] {
  return jobs.filter(isOpenChatRetryCandidate)
}
