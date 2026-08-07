import type { Profile } from '../shared/types'

export function emptyProfile(): Profile {
  return { syncedAt: 0, summary: '', skills: [] }
}

export function isProfileReady(p: Profile | null | undefined): boolean {
  return Boolean(p && p.summary.trim().length >= 40)
}

export function profileLabel(p: Profile | null | undefined): string {
  if (!p) return '未同步'
  const flag = p.analyzedByLlm ? 'LLM已归纳' : '未归纳'
  const chars = p.rawText?.length ?? 0
  return `${flag} · 原文 ${chars} 字`
}