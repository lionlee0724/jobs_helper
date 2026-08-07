import {
  DEFAULT_MIN_MATCH_SCORE,
  type Job,
  type MatchResult,
  type Policy,
  type Profile,
} from '../shared/types'
import { countKeywordHits } from './keyword-match'
import {
  evaluateHardRules,
  extractJobHardSignals,
  type HardRuleConfig,
} from './match-rules'
import { tierFromScore, type LlmMatchResult, type MatchTier } from './match-llm'
import { resolveMatchLlmWeight } from './policy'
import { formatLlmMatchFailureReason } from './match-display'

export { DEFAULT_MIN_MATCH_SCORE }

export type MatchMode = 'balanced' | 'keywords_only' | 'llm_only'

export type MatchDecision = {
  suitable: boolean
  /**
   * 综合分 0-100；`via=llm_error` 时省略（禁止关键词假分冒充语义结论）
   */
  score?: number
  tier: MatchTier
  /** 最终采用的通道 */
  via: 'llm' | 'keywords' | 'hybrid' | 'hard_reject' | 'skip' | 'llm_error'
  reasons: string[]
  confidence?: number
  keywordHits: string[]
  keywordHitCount: number
  llmScore?: number
  llmTier?: MatchTier
  llmConfidence?: number
  /** 硬否规则命中标识 */
  hardRules?: string[]
  /** LLM 报告的硬性阻碍 */
  blockers?: string[]
}

/** 匹配 LLM 失败（已放弃本岗语义判定）时的统一 fail-soft 决策 */
function llmErrorDecision(
  base: {
    keywordHits: string[]
    keywordHitCount: number
    llmScore?: number
    llmTier?: MatchTier
    llmConfidence?: number
    blockers?: string[]
  },
  llmError: string,
): MatchDecision {
  const head = formatLlmMatchFailureReason(llmError)
  return {
    ...base,
    suitable: false,
    // 故意不写 score：避免看板/事件展示「低分 N」
    tier: 'reject',
    via: 'llm_error',
    reasons: [head],
    confidence: 0,
  }
}

export function resolveMatchMode(policy: Policy): MatchMode {
  const m = policy.matchMode
  if (m === 'keywords_only' || m === 'llm_only' || m === 'keywords_or_llm') {
    // keywords_or_llm 与 balanced 同义（兼容旧字段）
    return m === 'keywords_or_llm' ? 'balanced' : m
  }
  return 'balanced'
}

/** 默认：命中 ≥2 个简历关键词才算有实质重叠 */
export function resolveMinKeywordHits(policy: Policy): number {
  if (policy.matchMinKeywordHits == null || !Number.isFinite(policy.matchMinKeywordHits)) {
    return 2
  }
  return Math.max(0, Math.floor(policy.matchMinKeywordHits))
}

/** 开聊所需的最低综合分；空/非法 → DEFAULT_MIN_MATCH_SCORE，并钳制 0–100 */
export function resolveMinScore(policy: Pick<Policy, 'minMatchScore'> | Policy): number {
  if (policy.minMatchScore == null || !Number.isFinite(policy.minMatchScore)) {
    return DEFAULT_MIN_MATCH_SCORE
  }
  return Math.max(0, Math.min(100, Math.floor(policy.minMatchScore)))
}

/**
 * 排除词规范化：支持 CSV 字符串或数组；trim、去空、去重（大小写不敏感，保留首次写法）。
 * 匹配侧仍按 toLowerCase 比较，此处不强制改成小写以免 UI 回显突兀。
 */
export function normalizeExcludeKeywords(
  input: string | string[] | null | undefined,
): string[] {
  const raw: string[] = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,，]/)
      : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const k = String(item ?? '').trim()
    if (!k) continue
    const key = k.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(k)
  }
  return out
}

/** 表单/存储写入用：空 → undefined；有值则钳制 0–100 */
export function normalizeMinMatchScore(
  raw: number | string | null | undefined,
): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n)) return undefined
  return Math.max(0, Math.min(100, Math.floor(n)))
}

/**
 * 期望城市规范化：CSV 或数组；trim、去空、去重（大小写不敏感）。
 * 空列表 → undefined（不启用城市硬否）。
 */
export function normalizeExpectCities(
  input: string | string[] | null | undefined,
): string[] | undefined {
  const list = normalizeExcludeKeywords(input)
  return list.length ? list : undefined
}

/**
 * 最低薪资 K：空 → undefined；有限正数钳制 1–999；≤0 视为未配置。
 */
export function normalizeMinSalaryK(
  raw: number | string | null | undefined,
): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.max(1, Math.min(999, Math.floor(n)))
}

/**
 * 年限差距：空 → undefined；允许 0；钳制 0–40。
 */
export function normalizeMaxYearsGap(
  raw: number | string | null | undefined,
): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.max(0, Math.min(40, Math.floor(n)))
}

/** 侧栏保存成功文案：生效硬否摘要 */
export function summarizeHardRulesForUi(
  policy: Pick<Policy, 'expectCities' | 'minSalaryK' | 'maxYearsGap' | 'excludeKeywords'>,
): string {
  const parts: string[] = []
  const cities = policy.expectCities?.filter((c) => c.trim()) ?? []
  if (cities.length) parts.push(`城市 ${cities.join('/')}`)
  if (policy.minSalaryK != null && policy.minSalaryK > 0) {
    parts.push(`最低薪 ${policy.minSalaryK}K`)
  }
  if (policy.maxYearsGap != null && policy.maxYearsGap >= 0) {
    parts.push(`年限差≤${policy.maxYearsGap}`)
  }
  const excludes = policy.excludeKeywords?.filter((k) => k.trim()) ?? []
  if (excludes.length) parts.push(`排除 ${excludes.length} 词`)
  return parts.length ? parts.join(' · ') : '无硬否（证据不足不拒绝）'
}

/** 关键词命中数 → 0-100 分。命中越多分越高，但单独不足以达到开投线 */
function keywordScore(hitCount: number, minHits: number): number {
  if (hitCount <= 0) return 0
  const need = Math.max(minHits, 1)
  const ratio = Math.min(1, hitCount / (need * 1.5)) // slightly more generous (was *2)
  // 关键词单通道封顶 65：字面命中 + past-job profile insights can push higher
  return Math.round(ratio * 65)
}

/**
 * 融合决策。
 *
 * 与早期「海投」版本的根本差异：
 * 1. 硬否规则优先，且是**确定性**的，不受语义模型影响
 * 2. LLM 输出分档评分而非布尔，低分不再被关键词「救回」
 * 3. 关键词只作为**佐证与兜底**，其单独得分封顶 60，无法凭字面命中达到高档
 * 4. 最终以综合分对比用户设定阈值决定是否开聊
 */
export function decideJobMatch(input: {
  profile: Profile
  job: Job
  policy: Policy
  llm?: LlmMatchResult | null
  llmError?: string
  hardRules?: HardRuleConfig
}): MatchDecision {
  const mode = resolveMatchMode(input.policy)
  const minHits = resolveMinKeywordHits(input.policy)
  const minScore = resolveMinScore(input.policy)
  const kw = countKeywordHits(input.profile, input.job)
  const llm = input.llm

  const base = {
    keywordHits: kw.hits.slice(0, 12),
    keywordHitCount: kw.hitCount,
    llmScore: llm?.score,
    llmTier: llm?.tier,
    llmConfidence: llm?.confidence,
    blockers: llm?.blockers,
  }

  // —— 0) 硬否规则：确定性冲突直接拒绝，不进入语义判断 ——
  // signals 预解析：salary 字段失败时从 title/desc 兜底，避免字体解码失败误放行
  const hard = evaluateHardRules({
    profile: input.profile,
    job: input.job,
    config: input.hardRules || {},
    signals: extractJobHardSignals(input.job),
  })
  if (hard.rejected) {
    return {
      ...base,
      suitable: false,
      score: 0,
      tier: 'reject',
      via: 'hard_reject',
      reasons: hard.reasons,
      hardRules: hard.rules,
    }
  }

  const kwScore = keywordScore(kw.hitCount, minHits)

  if (mode === 'keywords_only') {
    const pass = minHits > 0 && kw.hitCount >= minHits
    return {
      ...base,
      suitable: pass,
      score: kwScore,
      tier: tierFromScore(kwScore),
      via: pass ? 'keywords' : 'skip',
      reasons: pass
        ? [`关键词命中 ${kw.hitCount} 个（阈值 ${minHits}）：${kw.hits.slice(0, 5).join('、')}`]
        : [
            `关键词仅 ${kw.hitCount} 个，未达阈值 ${minHits}`,
            ...(kw.hits.length ? [`已命中：${kw.hits.slice(0, 5).join('、')}`] : []),
          ],
      confidence: kw.totalKeywords ? Math.min(1, kw.hitCount / Math.max(minHits, 1)) : 0,
    }
  }

  if (mode === 'llm_only') {
    if (!llm || llm.score == null) {
      // 有 llmError → fail-soft，禁止用 0 分冒充「评过分」
      if (input.llmError) return llmErrorDecision(base, input.llmError)
      return {
        ...base,
        suitable: false,
        score: 0,
        tier: 'reject',
        via: 'skip',
        reasons: ['LLM 无评分结果'],
      }
    }
    const pass = llm.score >= minScore
    return {
      ...base,
      suitable: pass,
      score: llm.score,
      tier: llm.tier ?? tierFromScore(llm.score),
      via: pass ? 'llm' : 'skip',
      reasons: llm.reasons.length
        ? llm.reasons
        : [`LLM 评分 ${llm.score}（阈值 ${minScore}）`],
      confidence: llm.confidence,
    }
  }

  // —— balanced ——
  // 匹配所需 LLM 已失败：禁止关键词兜底分冒充综合分（旧「低分 30 · LLM 异常」）
  if (input.llmError && (!llm || llm.score == null)) {
    return llmErrorDecision(base, input.llmError)
  }

  // LLM 有结果但缺 score（模型未按格式输出）：按其布尔判断折算，
  // 绝不能当成「LLM 不可用」而走关键词兜底 —— 那会把否定判断悄悄丢掉。
  const effectiveLlm: LlmMatchResult | null =
    llm && llm.score == null
      ? { ...llm, score: llm.suitable ? 60 : 25, tier: llm.suitable ? 'moderate' : 'reject' }
      : llm ?? null

  // 真正无结果且无 error 时才退回关键词，并明确标注可信度受限
  if (!effectiveLlm || effectiveLlm.score == null) {
    const pass = minHits > 0 && kw.hitCount >= minHits && kwScore >= minScore
    return {
      ...base,
      suitable: pass,
      score: kwScore,
      tier: tierFromScore(kwScore),
      via: pass ? 'keywords' : 'skip',
      reasons: [
        'LLM 无评分',
        kw.hitCount > 0
          ? `关键词命中 ${kw.hitCount}：${kw.hits.slice(0, 5).join('、')}（关键词单通道最高 60 分）`
          : '简历关键词未在职位中命中',
      ],
      confidence: 0.3,
    }
  }

  // 语义分为主（权重可配，默认 0.75），关键词为辅（1 - LLM 权重）
  // 关键词单通道封顶 65 已在 keywordScore 中保留
  const llmWeight = resolveMatchLlmWeight(input.policy)
  const kwWeight = 1 - llmWeight
  const llmScore = effectiveLlm.score
  const combined = Math.round(llmScore * llmWeight + kwScore * kwWeight)
  const tier = tierFromScore(combined)
  const pass = combined >= minScore

  const reasons = [...(effectiveLlm.reasons || [])]
  if (kw.hitCount > 0) {
    reasons.push(`关键词佐证 ${kw.hitCount}：${kw.hits.slice(0, 4).join('、')}`)
  }
  if (effectiveLlm.blockers?.length) {
    reasons.push(`阻碍：${effectiveLlm.blockers.slice(0, 2).join('；')}`)
  }
  reasons.push(
    `综合分 ${combined}（LLM ${llmScore} × ${llmWeight.toFixed(2)} + 关键词 ${kwScore} × ${kwWeight.toFixed(2)}），阈值 ${minScore}`,
  )

  return {
    ...base,
    llmScore,
    llmTier: effectiveLlm.tier,
    suitable: pass,
    score: combined,
    tier,
    via: kw.hitCount > 0 ? 'hybrid' : 'llm',
    reasons: reasons.slice(0, 7),
    confidence: effectiveLlm.confidence,
  }
}

export function decisionToMatchResult(d: MatchDecision): MatchResult {
  return {
    suitable: d.suitable,
    reasons: d.reasons,
    confidence: d.confidence,
    // llm_error 等路径省略 score，避免写入 undefined 键
    ...(d.score != null ? { score: d.score } : {}),
    tier: d.tier,
    via: d.via,
  }
}
