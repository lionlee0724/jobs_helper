import { getDb } from '../db'
import type { Job, JobRecord, MatchResult } from '../../shared/types'
import { normalizeJob } from '../../domain/job'

/** 简单的职位指纹（标题+公司），用于去重处理相同岗位 */
export function jobFingerprint(title?: string, company?: string): string {
  const t = (title || '').trim().toLowerCase()
  const c = (company || '').trim().toLowerCase()
  if (!t || !c) return 'fp:|'
  return `fp:${t.slice(0, 100)}|${c.slice(0, 100)}`
}


export async function listAllJobs() {
  return getDb().jobs.toArray()
}

/**
 * 分析已投递岗位（从 IndexedDB jobs 表提取成功/失败数据），完善用户画像。
 * 用于指导后续评分优化，降低不适合岗位机会。
 */
export async function analyzePastJobs(): Promise<{
  stats: {
    total: number
    opened: number
    skipped: number
    failed: number
    suitableRate: number
    avgSuccessScore: number | null
  }
  profileInsights: {
    commonKeywords: string[]
    experiencePatterns: string[]
    salaryRanges: string[]
    successSignals: string[]
    failureReasons: string[]
    topTitles: string[]
  }
}> {
  const all = await listAllJobs()
  const successful = all.filter((j) => j.outcome === 'opened' || j.match?.suitable === true)
  const skipped = all.filter((j) => j.outcome === 'skipped')
  const failed = all.filter((j) => j.outcome === 'failed')

  const keywordCounts = new Map<string, number>()
  const bump = (raw: string, weight = 1) => {
    const k = raw.replace(/\s+/g, ' ').trim()
    if (!k || k.length < 2 || k.length > 24) return
    if (/^\d+$/.test(k)) return
    if (/登录|注册|立即沟通|不感兴趣|举报|分享|BOSS|直聘/.test(k)) return
    keywordCounts.set(k, (keywordCounts.get(k) || 0) + weight)
  }

  for (const job of successful) {
    const hits = (job.match as { keywordHits?: string[] } | undefined)?.keywordHits
    if (Array.isArray(hits)) {
      for (const h of hits) bump(String(h), 3)
    }
    const title = (job.title || '').trim()
    if (title) {
      bump(title, 2)
      title.split(/[\/｜|·•、,，\-—_\s]+/).forEach((p) => bump(p, 2))
    }
    const desc = (job.desc || '').slice(0, 1200)
    const phrases = desc.match(/[\u4e00-\u9fff]{2,8}/g) || []
    for (const p of phrases.slice(0, 40)) {
      if (/项目|管理|销售|交付|实施|方案|政府|信息化|应急|智慧|园区|客户|商务|产品|研发|运维|数据分析|招投标|售前|售后/.test(p)) {
        bump(p, 1)
      }
    }
  }

  const commonKeywords = [...keywordCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .slice(0, 25)
    .map(([k]) => k)

  const yearMentions = new Map<string, number>()
  for (const job of successful) {
    const text = String((job as { experience?: string }).experience || '') + ' ' + (job.title || '') + ' ' + (job.desc || '').slice(0, 400)
    const m = text.match(/(\d+)\s*[-~～—–]?\s*(\d+)?\s*年/)
    if (m) {
      const label = m[2] ? m[1] + '-' + m[2] + '年' : m[1] + '年'
      yearMentions.set(label, (yearMentions.get(label) || 0) + 1)
    }
  }
  const experiencePatterns = [...yearMentions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k)

  const salaryMentions = new Map<string, number>()
  for (const job of [...successful, ...all]) {
    const text = String((job as { salary?: string }).salary || '') + ' ' + (job.title || '')
    const m = text.match(/(\d+(?:\.\d+)?)\s*[-~～—–]\s*(\d+(?:\.\d+)?)\s*([KkWw千万])?/)
    if (m) {
      const unit = (m[3] || 'K').toUpperCase().replace('万', 'W')
      const label = m[1] + '-' + m[2] + unit
      salaryMentions.set(label, (salaryMentions.get(label) || 0) + 1)
    }
  }
  const salaryRanges = [...salaryMentions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => k)

  const successScores = successful
    .map((j) => (j.match as { score?: number } | undefined)?.score)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  const avgSuccessScore =
    successScores.length > 0
      ? Math.round(successScores.reduce((a, b) => a + b, 0) / successScores.length)
      : null

  const failureReasonCounts = new Map<string, number>()
  for (const job of [...skipped, ...failed]) {
    const reasons = ((job.match as { reasons?: string[] } | undefined)?.reasons) || ['未处理/无理由']
    for (const r of reasons.slice(0, 2)) {
      const key = String(r).replace(/\s+/g, ' ').trim().slice(0, 80)
      if (!key) continue
      failureReasonCounts.set(key, (failureReasonCounts.get(key) || 0) + 1)
    }
  }

  return {
    stats: {
      total: all.length,
      opened: successful.length,
      skipped: skipped.length,
      failed: failed.length,
      suitableRate: all.length ? successful.length / all.length : 0,
      avgSuccessScore,
    },
    profileInsights: {
      commonKeywords,
      experiencePatterns,
      salaryRanges,
      successSignals: successful
        .map((j) => ((j.match as { reasons?: string[] } | undefined)?.reasons?.[0] as string) || j.title || 'suitable')
        .filter(Boolean)
        .slice(0, 12),
      failureReasons: [...failureReasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([k, n]) => (n > 1 ? k + ' ×' + n : k)),
      topTitles: successful
        .map((j) => (j.title || '').trim())
        .filter(Boolean)
        .slice(0, 10),
    },
  }
}

export async function isHandled(id: string): Promise<boolean> {
  const job = await getDb().jobs.get(id)
  return !!job && !!job.outcome
}

export async function isHandledByFingerprint(title?: string, company?: string): Promise<boolean> {
  const fp = jobFingerprint(title, company)
  if (fp === 'fp:|') return false
  const all = await listAllJobs()
  return all.some((j) => j.outcome && jobFingerprint(j.title, j.company) === fp)
}

export async function upsertJobSeen(job: Job): Promise<void> {
  const db = getDb()
  const normalized = normalizeJob(job)
  const existing = await db.jobs.get(normalized.id)
  const now = Date.now()
  const record: JobRecord = {
    ...(existing || {}),
    ...normalized,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    match: existing?.match,
    outcome: existing?.outcome,
    openChatAt: existing?.openChatAt,
  }
  await db.jobs.put(record)
}

export async function markSkipped(id: string, reason?: string): Promise<void> {
  const db = getDb()
  const job = await db.jobs.get(id)
  if (!job) return
  await db.jobs.put({
    ...job,
    outcome: 'skipped' as const,
    lastSeenAt: Date.now(),
    match: job.match || {
      suitable: false,
      reasons: reason ? [reason] : ['skipped'],
      score: 0,
      matchedAt: Date.now(),
    },
  })
}

export async function markOpened(id: string): Promise<void> {
  const db = getDb()
  const job = await db.jobs.get(id)
  if (!job) return
  await db.jobs.put({
    ...job,
    outcome: 'opened' as const,
    lastSeenAt: Date.now(),
    match: job.match || {
      suitable: true,
      reasons: ['opened'],
      score: 80,
      matchedAt: Date.now(),
    },
  })
}

/**
 * 标记开聊/动作失败。
 * **保留**已有 match（合适分不能被「失败」冲成不合适）。
 */
export async function markFailed(id: string, error?: string): Promise<void> {
  const db = getDb()
  const job = await db.jobs.get(id)
  if (!job) return
  const err = (error || '操作失败').replace(/\s+/g, ' ').trim().slice(0, 200)
  await db.jobs.put({
    ...job,
    outcome: 'failed' as const,
    lastSeenAt: Date.now(),
    lastError: err,
    // 绝不覆盖已有匹配结论；仅无 match 时写占位
    match: job.match
      ? job.match
      : {
          suitable: false,
          reasons: [err],
          score: 0,
          matchedAt: Date.now(),
        },
  })
}

/**
 * 将「合适但开聊失败」的岗清掉 outcome，使下一轮 tick 可再次尝试开聊。
 */
export async function clearFailedOpenForRetry(id: string): Promise<boolean> {
  const db = getDb()
  const job = await db.jobs.get(id)
  if (!job) return false
  if (job.match?.suitable !== true || job.outcome !== 'failed') return false
  const { outcome: _o, lastError: _e, ...rest } = job
  await db.jobs.put({
    ...rest,
    lastSeenAt: Date.now(),
    // 明确去掉终态，保留 match
    outcome: undefined,
    lastError: undefined,
  } as typeof job)
  return true
}

export async function clearAllFailedOpenForRetry(): Promise<number> {
  const all = await listAllJobs()
  let n = 0
  for (const j of all) {
    if (j.match?.suitable === true && j.outcome === 'failed') {
      if (await clearFailedOpenForRetry(j.id)) n++
    }
  }
  return n
}

export async function saveMatch(id: string, match: MatchResult, model?: string): Promise<void> {
  const db = getDb()
  const job = await db.jobs.get(id)
  if (!job) return
  await db.jobs.put({
    ...job,
    match: {
      ...match,
      model,
      matchedAt: Date.now(),
    },
    lastSeenAt: Date.now(),
  })
}

export async function getJob(id: string): Promise<JobRecord | undefined> {
  return getDb().jobs.get(id)
}
