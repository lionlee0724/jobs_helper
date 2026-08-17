import type { Job, Profile } from '../shared/types'

/** 从简历 skills / highlights / expectRoles 抽可匹配关键词 */
export function extractProfileKeywords(profile: Profile): string[] {
  const raw: string[] = []
  for (const s of profile.skills || []) raw.push(s)
  for (const h of profile.highlights || []) {
    // 亮点可能是整句：再按常见分隔拆
    raw.push(h)
    raw.push(...h.split(/[、，,；;/|·•\s]+/))
  }
  for (const r of profile.expectRoles || []) raw.push(r)

  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const t = (item || '').trim()
    if (!t) continue
    // 过短易误伤（如「的」「和」）；过长整句命中率低
    if (t.length < 2 || t.length > 20) continue
    if (/^[0-9.]+$/.test(t)) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

export type KeywordHitResult = {
  hits: string[]
  totalKeywords: number
  hitCount: number
  /** 职位侧检索文本长度 */
  haystackLen: number
}

/**
 * 在职位标题+描述中统计简历关键词命中（子串，不区分大小写）。
 * 长词优先：已命中的长词覆盖的短词仍可计（用户要的是「出现了几个关键字」）。
 */
export function countKeywordHits(
  profile: Profile,
  job: Pick<Job, 'title' | 'company' | 'desc' | 'salary' | 'city'>,
): KeywordHitResult {
  const keywords = extractProfileKeywords(profile)
  const haystack = [job.title, job.company, job.salary, job.city, job.desc]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()

  const hits: string[] = []
  for (const kw of keywords) {
    if (haystack.includes(kw.toLowerCase())) hits.push(kw)
  }
  return {
    hits,
    totalKeywords: keywords.length,
    hitCount: hits.length,
    haystackLen: haystack.length,
  }
}

/** 命中数 ≥ 阈值则视为「值得开聊」 */
export function keywordMatchPasses(
  profile: Profile,
  job: Pick<Job, 'title' | 'company' | 'desc' | 'salary' | 'city'>,
  minHits: number,
): KeywordHitResult & { pass: boolean } {
  const r = countKeywordHits(profile, job)
  const need = Number.isFinite(minHits) ? Math.max(0, Math.floor(minHits)) : 0
  return {
    ...r,
    pass: need > 0 && r.hitCount >= need,
  }
}
