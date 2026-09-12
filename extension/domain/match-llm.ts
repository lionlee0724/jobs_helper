import type { Job, MatchResult, Profile } from '../shared/types'

export function buildMatchMessages(profile: Profile, job: Job) {
  const system = `你是专业求职匹配评估器。评估候选人与目标职位的**分档评分**（0-100），不做二元绝对判断。
只输出 JSON，不要 markdown：
{"score":0-100,"tier":"strong"|"moderate"|"weak"|"reject","reasons":string[],"blockers":string[],"confidence":0-1}

核心评估原则（务实评估，注重主干技能与可迁移性）：
1. 抓大放小：重点评估「核心主职责」与「主技术栈/主业务领域」，区分核心必备要求与 JD 常见的锦上添花加分项（Wishlist）。
2. 允许技能可迁移：只要候选人在同技术族或相近业务域有扎实经验，辅助中间件/工具缺失不应作为重度扣分项。
3. 杜绝过度苛刻：不要因为没有 100% 涵盖 JD 罗列的所有次要关键词就评为 weak/reject。

可迁移同族（职能与业务高度相通，应按同方向积极给分，评为 moderate 60-74 或 strong 75-100）：
- 技术开发族：Java / Go / C++ / Python 后端；前端 React / Vue / TS / Web / 小程序 / 全栈；移动端 Android / iOS / Flutter
- 架构与基建：架构师 / 技术专家 / 研发主管；DevOps / SRE / 云原生 / 运维 / K8s / 基础架构
- AI与数据：算法 / 大模型 / LLM / AIGC / NLP / CV / 机器学习；数据开发 / 数据分析 / ETL / 数仓 / BI
- 项目与交付：项目经理 / 交付经理 / 实施经理 / PMO / 技术项目主管 / Scrum Master
- 解决方案与售前：售前专家 / 解决方案架构师 / 方案经理 / 售前顾问 / 技术支持经理
- 产品与设计：产品经理 / 产品专家 / 需求分析师 / 业务架构师；UI / UX / 用户体验 / 交互设计
- 销售与商务：大客户销售 / 商务经理 / 客户经理 / BD / 渠道销售 / 客户成功 (CSM)
- 运营与市场：用户运营 / 内容运营 / 产品运营 / 活动运营 / 增长 / 新媒体 / 市场营销

分档含义：
- strong (75-100)：核心职责与主技能高度吻合，是非常匹配的人选
- moderate (55-74)：主干方向一致，核心技能具备，虽有部分次要技术/行业 gap 但完全可迁移胜任
- weak (30-54)：核心方向偏离较远，或明确缺少该岗位的核心主干能力
- reject (0-29)：完全不同的工种或职能方向

重要规则：
- 请务实评分。主干匹配且具备可迁移性时，基准分应给到 moderate 中段及以上（约 60–74）。
- blockers 仅记录无法跨越的硬性冲突（例如「要求5年C++底层开发，简历仅有纯前端经验」）。若无硬性冲突，blockers 输出空数组 []。
- reasons 必须简要列出 2~4 条具体的匹配点（如「主技能Java契合、高并发经验相符」）或主要差距。
- 薪资/城市缺失不作为扣分项（上游已有规则拦截）。`

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