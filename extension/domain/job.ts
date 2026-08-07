import type { Job, JobSource } from '../shared/types'

export function normalizeJob(
  partial: Partial<Job> & { id: string; source: JobSource },
): Job {
  return {
    id: partial.id,
    title: partial.title?.trim() || '未知职位',
    company: partial.company?.trim() || '未知公司',
    salary: partial.salary,
    city: partial.city,
    desc: partial.desc?.trim() || '',
    source: partial.source,
  }
}

export function jobKey(id: string, source?: JobSource) {
  return source ? `${source}:${id}` : id
}

export function truncateDesc(desc: string, max = 12000) {
  if (desc.length <= max) return desc
  return desc.slice(0, max) + '…'
}

export type ListedJob = Pick<Job, 'id' | 'title' | 'company' | 'salary' | 'city' | 'source'>