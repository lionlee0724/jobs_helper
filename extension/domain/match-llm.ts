import type { Job, MatchResult, Profile } from '../shared/types'

export function buildMatchMessages(profile: Profile, job: Job) {
  const system = `你是求职匹配评估器。给出候选人与该职位的**分档评分**，不做二元判断。
只输出 JSON，不要 markdown：
{"score":0-100,"tier":"strong"|"moderate"|"weak"|"reject","reasons":string[],"blockers":string[],"confidence":0-1}

评分维度（各自独立判断，再综合）：
1. 职能方向契合度：职位核心职责与候选人主业务经验是否同一条线
2. 硬技能重叠：JD 明确要求的技能/工具中候选人具备的比例
3. 层级与职责范围：职级、团队规模、决策权是否匹配
4. 行业背景：相关行业经验是否可迁移

分档含义：
- strong (75-100)：核心职责高度重叠，候选人是明确合适的人选
- moderate (55-74)：主方向一致但有明显 gap（行业、层级或部分技能）
- weak (30-54)：仅部分沾边，投递性价比低
- reject (0-29)：方向不符，不应投递

硬性阻碍写入 blockers（如「要求 5 年 Java，简历无后端经验」）。

重要：
- 请如实评分。不要为了鼓励投递而抬高分数，也不要因为不是完美匹配就给 reject
- 信息不足以判断时，降低 confidence，并在 reasons 写明「信息不足：…」，而不是随意给分
- 薪资/城市缺失不视为硬性阻碍（上游已做确定性筛查）；聚焦职能与技能
- reasons 要具体指出哪些点匹配/不匹配，禁止「比较合适」这类空话
- blockers 只写可验证的硬冲突；没有则输出空数组`

  // 控制 token：rawText 缩到 2500；JD 缩到 6000（硬否已先筛，不必喂全量噪声）
  const user = `【候选人】
摘要：${profile.summary}
技能：${profile.skills.join('、') || '（无）'}
${profile.years ? `年限：${profile.years}` : ''}
${profile.education ? `学历：${profile.education}` : ''}
${profile.expectRoles?.length ? `期望：${profile.expectRoles.join('、')}` : ''}
${profile.highlights?.length ? `亮点：\n- ${profile.highlights.slice(0, 8).join('\n- ')}` : ''}
${profile.rawText ? `原文片段：\n${profile.rawText.slice(0, 2500)}` : ''}

【职位】
标题：${job.title}
公司：${job.company}
薪资：${job.salary ?? '未知'}
城市：${job.city ?? '未知'}
描述：
${job.desc.slice(0, 6000)}`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

export type MatchTier = 'strong' | 'moderate' | 'weak' | 'reject'

export type LlmMatchResult = MatchResult & {
  score?: number
  tier?: MatchTier
  blockers?: string[]
}

const TIERS: MatchTier[] = ['strong', 'moderate', 'weak', 'reject']

/** 分数 → 档位（模型未给 tier 或给错时的权威来源） */
export function tierFromScore(score: number): MatchTier {
  if (score >= 75) return 'strong'
  if (score >= 55) return 'moderate'
  if (score >= 30) return 'weak'
  return 'reject'
}

/**
 * 解析分档评分结果。
 *
 * 分数是唯一权威来源：模型自报的 tier 与分数不一致时以分数为准，
 * 避免“写 reject 但给 80 分”这类矛盾输出产生不可预测行为。
 */
export function parseMatchResult(raw: string): LlmMatchResult {
  const json = extractJson(raw)
  if (!json || typeof json !== 'object') {
    throw new Error('匹配结果无法解析为 JSON')
  }
  const o = json as Record<string, unknown>

  const rawScore = typeof o.score === 'number' ? o.score : undefined
  const score =
    rawScore != null ? Math.max(0, Math.min(100, Math.round(rawScore))) : undefined

  const declared =
    typeof o.tier === 'string' && TIERS.includes(o.tier as MatchTier)
      ? (o.tier as MatchTier)
      : undefined

  const tier = score != null ? tierFromScore(score) : declared

  return {
    // 向后兼容：旧调用方仍读 suitable
    suitable: tier != null ? tier === 'strong' || tier === 'moderate' : Boolean(o.suitable),
    score,
    tier,
    blockers: Array.isArray(o.blockers) ? o.blockers.map(String).slice(0, 5) : [],
    reasons: Array.isArray(o.reasons)
      ? o.reasons.map(String).slice(0, 8)
      : [],
    confidence:
      typeof o.confidence === 'number' ? clamp01(o.confidence) : undefined,
  }
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

export function extractJson(raw: string): unknown {
  let text = raw.trim()
  // 去掉 ```json ... ``` 包裹
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}