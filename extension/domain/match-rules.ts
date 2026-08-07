/**
 * 硬否规则 — 纯函数，在调用 LLM 之前执行。
 *
 * 目的有二：
 * 1. 语义判断解决不了确定性冲突（城市、薪资、年限、学历），这类应当**确定性拒绝**，
 *    而不是交给概率模型
 * 2. 先筛掉明确不合适的职位可以省掉 LLM 调用，也减少无谓的页面操作次数，
 *    间接降低风控暴露
 *
 * 设计原则：**证据不足时不拒绝**。读不到薪资、JD 里没写年限要求等情况一律放行，
 * 交由后续语义判断，避免因抓取缺陷误杀。
 */

import type { Job, Policy, Profile } from '../shared/types'

export type HardRuleConfig = {
  /** 期望城市；为空表示不限。命中任一即通过 */
  expectCities?: string[]
  /** 最低薪资下限（单位 K/月）；职位薪资上限低于此值则拒绝 */
  minSalaryK?: number
  /** 标题或 JD 命中即拒绝的词 */
  excludeKeywords?: string[]
  /** 候选人年限与 JD 要求的最大允许差距（年） */
  maxYearsGap?: number
}

export type HardRuleVerdict = {
  rejected: boolean
  /** 触发的规则名与原因 */
  reasons: string[]
  /** 命中的规则标识，用于统计 */
  rules: string[]
}

/**
 * 职位侧预解析字段：从 title/salary/desc 抽出确定性信号，
 * 供硬否与日志复用，避免多处重复正则。
 * 全部为「能抽则抽，抽不到 null」—— 不改变「证据不足不拒绝」。
 */
export type JobHardSignals = {
  salaryRange: { min: number; max: number } | null
  requiredYears: number | null
  /** 用于硬否/关键词的检索文本（title + desc，小写） */
  haystack: string
}

/** 从 Policy 抽出硬否配置（background / decide 共用） */
export function hardRulesFromPolicy(
  policy: Pick<Policy, 'expectCities' | 'minSalaryK' | 'excludeKeywords' | 'maxYearsGap'>,
): HardRuleConfig {
  return {
    expectCities: policy.expectCities,
    minSalaryK: policy.minSalaryK,
    excludeKeywords: policy.excludeKeywords,
    maxYearsGap: policy.maxYearsGap,
  }
}

/** 是否配置了任意硬否条件（无配置则跳过评估） */
export function hasAnyHardRule(config: HardRuleConfig | undefined | null): boolean {
  if (!config) return false
  if (config.minSalaryK != null && config.minSalaryK > 0) return true
  if (config.maxYearsGap != null && config.maxYearsGap >= 0) return true
  if ((config.expectCities || []).some((c) => c.trim())) return true
  if ((config.excludeKeywords || []).some((k) => k.trim())) return true
  return false
}

/** 解析 "12-20K" / "15-25K·13薪" / "面议" → { min, max } 单位 K */
export function parseSalaryRange(
  salary: string | undefined | null,
): { min: number; max: number } | null {
  if (!salary) return null
  const t = salary.replace(/\s+/g, '')
  if (/面议|面谈|薪资面议/.test(t)) return null

  // 常见区间：12-15K / 15-25K·13薪 / 1.5-2W / 10～20k
  const m = t.match(/(\d+(?:\.\d+)?)\s*[-~～—–]\s*(\d+(?:\.\d+)?)\s*([KkWw千万])?/)
  if (m) {
    let min = Number(m[1])
    let max = Number(m[2])
    const unit = m[3]
    if (unit === 'W' || unit === 'w' || unit === '万') {
      min *= 10
      max *= 10
    } else if (unit === '千') {
      // 千 == K
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null
    // 形状校验：月薪合理上界（避免解析到年薪/乱码）
    if (max > 999) return null
    return { min, max }
  }

  // 单值：15K / 2W / 15K以上
  const single = t.match(/(\d+(?:\.\d+)?)\s*([KkWw千万])(?:以上|\+)?/)
  if (single) {
    let v = Number(single[1])
    if (/[Ww万]/.test(single[2])) v *= 10
    if (!Number.isFinite(v) || v <= 0 || v > 999) return null
    return { min: v, max: v }
  }
  return null
}

/**
 * 从职位字段解析薪资：优先 salary 字段，其次从 title 兜底
 * （列表卡偶发把薪资写在标题附近或 salary 解码失败）。
 */
export function resolveJobSalaryRange(
  job: Pick<Job, 'salary' | 'title' | 'desc'>,
): { min: number; max: number } | null {
  return (
    parseSalaryRange(job.salary) ||
    parseSalaryRange(job.title) ||
    // 描述前 200 字偶发带「薪资 15-25K」
    parseSalaryRange((job.desc || '').slice(0, 200)) ||
    null
  )
}

/** 从 JD 抽取要求的最低年限；抽不到返回 null */
export function extractRequiredYears(desc: string): number | null {
  if (!desc) return null

  // 区间写法优先：「3-5年」的最低要求是 3，不是 5。
  // 必须先于单值匹配，否则会错误地取到上界。
  const range = desc.match(/(\d{1,2})\s*[-~～至]\s*(\d{1,2})\s*年/)
  if (range) {
    const lo = Number(range[1])
    if (Number.isFinite(lo) && lo >= 0 && lo <= 40) return lo
  }

  // 「至少 3 年」「3 年以上工作经验」「工作经验：5年」
  const atLeast = desc.match(/(?:至少|不少于|不低于)\s*(\d{1,2})\s*年/)
  if (atLeast) {
    const v = Number(atLeast[1])
    if (Number.isFinite(v) && v >= 0 && v <= 40) return v
  }

  const m = desc.match(/(\d{1,2})\s*年(?:以上|及以上|\+|工作经验|经验)?/)
  if (m) {
    const v = Number(m[1])
    if (Number.isFinite(v) && v >= 0 && v <= 40) return v
  }
  if (/应届|无经验|经验不限|不限经验/.test(desc)) return 0
  return null
}

/** 从简历 years 字段抽数字，如 "10年" → 10 */
export function parseProfileYears(years?: string): number | null {
  if (!years) return null
  const m = String(years).match(/(\d{1,2})/)
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) && v >= 0 && v <= 50 ? v : null
}

/** 预解析职位硬信号（纯函数，可单测、可缓存） */
export function extractJobHardSignals(
  job: Pick<Job, 'title' | 'company' | 'salary' | 'city' | 'desc'>,
): JobHardSignals {
  return {
    salaryRange: resolveJobSalaryRange(job),
    requiredYears: extractRequiredYears(job.desc || ''),
    haystack: `${job.title || ''}\n${job.desc || ''}`.toLowerCase(),
  }
}

/**
 * 执行硬否规则。
 *
 * 每条规则都遵循「证据不足则放行」：
 * - 薪资读不到（字体混淆解码失败）→ 不因薪资拒绝
 * - JD 未写年限 → 不因年限拒绝
 * - 未配置期望城市 → 不做城市判断
 */
export function evaluateHardRules(input: {
  profile: Profile
  job: Job
  config: HardRuleConfig
  /** 可选：调用方已预解析的信号，避免重复正则 */
  signals?: JobHardSignals
}): HardRuleVerdict {
  const { profile, job, config } = input
  const reasons: string[] = []
  const rules: string[] = []
  const signals = input.signals ?? extractJobHardSignals(job)

  // 1) 排除词
  const excludes = (config.excludeKeywords || []).filter((k) => k.trim())
  if (excludes.length) {
    const hit = excludes.find((k) => signals.haystack.includes(k.trim().toLowerCase()))
    if (hit) {
      rules.push('exclude_keyword')
      reasons.push(`命中排除词「${hit}」`)
    }
  }

  // 2) 城市
  const cities = (config.expectCities || []).filter((c) => c.trim())
  if (cities.length && job.city) {
    const jc = job.city
    const ok = cities.some((c) => jc.includes(c.trim()) || c.trim().includes(jc))
    if (!ok) {
      rules.push('city_mismatch')
      reasons.push(`城市「${job.city}」不在期望范围（${cities.join('、')}）`)
    }
  }

  // 3) 薪资：只有能解析出范围时才判断（salary 字段失败时已尝试 title/desc 兜底）
  if (config.minSalaryK != null && config.minSalaryK > 0) {
    const range = signals.salaryRange
    if (range && range.max < config.minSalaryK) {
      rules.push('salary_below_floor')
      reasons.push(`薪资上限 ${range.max}K 低于下限要求 ${config.minSalaryK}K`)
    }
  }

  // 4) 年限差距：仅当 JD 明确写了要求且简历有年限
  if (config.maxYearsGap != null && config.maxYearsGap >= 0) {
    const need = signals.requiredYears
    const have = parseProfileYears(profile.years)
    if (need != null && have != null && need - have > config.maxYearsGap) {
      rules.push('years_gap')
      reasons.push(`要求 ${need} 年经验，简历 ${have} 年，差距超过 ${config.maxYearsGap} 年`)
    }
  }

  return { rejected: rules.length > 0, reasons, rules }
}
