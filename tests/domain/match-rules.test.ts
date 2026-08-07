import { describe, it, expect } from 'vitest'
import {
  parseSalaryRange,
  extractRequiredYears,
  parseProfileYears,
  evaluateHardRules,
  resolveJobSalaryRange,
  extractJobHardSignals,
  hardRulesFromPolicy,
  hasAnyHardRule,
} from '../../extension/domain/match-rules'
import type { Job, Profile } from '../../extension/shared/types'

const profile: Profile = {
  syncedAt: 0,
  summary: '10 年项目管理',
  skills: ['项目管理', '交付'],
  years: '10年',
}

const job = (over: Partial<Job> = {}): Job => ({
  id: '1',
  title: '项目经理',
  company: 'A 公司',
  desc: '负责项目交付',
  source: 'current',
  ...over,
})

describe('parseSalaryRange', () => {
  it('解析常见区间', () => {
    expect(parseSalaryRange('12-15K')).toEqual({ min: 12, max: 15 })
    expect(parseSalaryRange('15-25K·13薪')).toEqual({ min: 15, max: 25 })
  })
  it('万单位换算为 K', () => {
    expect(parseSalaryRange('1.5-2W')).toEqual({ min: 15, max: 20 })
  })
  it('面议与无法解析返回 null', () => {
    expect(parseSalaryRange('面议')).toBeNull()
    expect(parseSalaryRange('-K')).toBeNull()
    expect(parseSalaryRange(undefined)).toBeNull()
  })
})

describe('extractRequiredYears', () => {
  it('抽取年限要求', () => {
    expect(extractRequiredYears('要求5年以上经验')).toBe(5)
    expect(extractRequiredYears('3-5年经验')).toBe(3)
  })
  it('至少/不少于写法', () => {
    expect(extractRequiredYears('至少3年相关经验')).toBe(3)
    expect(extractRequiredYears('不少于5年项目管理经验')).toBe(5)
  })
  it('应届/不限识别为 0', () => {
    expect(extractRequiredYears('接受应届生')).toBe(0)
    expect(extractRequiredYears('经验不限')).toBe(0)
  })
  it('未写要求返回 null', () => {
    expect(extractRequiredYears('负责日常运营')).toBeNull()
  })
})

describe('parseProfileYears', () => {
  it('从简历年限抽数字', () => {
    expect(parseProfileYears('10年')).toBe(10)
    expect(parseProfileYears(undefined)).toBeNull()
  })
})

describe('evaluateHardRules — 证据不足时不拒绝', () => {
  it('薪资读不到时不因薪资拒绝', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ salary: undefined }),
      config: { minSalaryK: 30 },
    })
    expect(r.rejected).toBe(false)
  })

  it('JD 未写年限时不因年限拒绝', () => {
    const r = evaluateHardRules({
      profile: { ...profile, years: '1年' },
      job: job({ desc: '负责日常运营' }),
      config: { maxYearsGap: 2 },
    })
    expect(r.rejected).toBe(false)
  })

  it('未配置期望城市时不做城市判断', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ city: '北京' }),
      config: {},
    })
    expect(r.rejected).toBe(false)
  })
})

describe('evaluateHardRules — 确定性冲突拒绝', () => {
  it('薪资上限低于下限要求', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ salary: '8-12K' }),
      config: { minSalaryK: 20 },
    })
    expect(r.rejected).toBe(true)
    expect(r.rules).toContain('salary_below_floor')
  })

  it('薪资上限达标则放行', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ salary: '15-25K' }),
      config: { minSalaryK: 20 },
    })
    expect(r.rejected).toBe(false)
  })

  it('城市不符', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ city: '北京·朝阳区' }),
      config: { expectCities: ['武汉'] },
    })
    expect(r.rejected).toBe(true)
    expect(r.rules).toContain('city_mismatch')
  })

  it('城市包含匹配可通过', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ city: '武汉·汉南区·纱帽' }),
      config: { expectCities: ['武汉'] },
    })
    expect(r.rejected).toBe(false)
  })

  it('排除词命中', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ title: '销售代表' }),
      config: { excludeKeywords: ['销售'] },
    })
    expect(r.rejected).toBe(true)
    expect(r.rules).toContain('exclude_keyword')
  })

  it('年限差距超限', () => {
    const r = evaluateHardRules({
      profile: { ...profile, years: '1年' },
      job: job({ desc: '要求8年以上大型项目经验' }),
      config: { maxYearsGap: 2 },
    })
    expect(r.rejected).toBe(true)
    expect(r.rules).toContain('years_gap')
  })

  it('候选人经验高于要求不算差距', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ desc: '要求3年以上经验' }),
      config: { maxYearsGap: 2 },
    })
    expect(r.rejected).toBe(false)
  })

  it('salary 字段缺失时从 title 兜底解析薪资', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ salary: undefined, title: '项目经理 8-12K' }),
      config: { minSalaryK: 20 },
    })
    expect(r.rejected).toBe(true)
    expect(r.rules).toContain('salary_below_floor')
  })
})

describe('resolveJobSalaryRange / extractJobHardSignals', () => {
  it('优先 salary，其次 title', () => {
    expect(resolveJobSalaryRange(job({ salary: '20-30K', title: '8-12K 销售' }))).toEqual({
      min: 20,
      max: 30,
    })
    expect(resolveJobSalaryRange(job({ salary: undefined, title: '后端 15-25K' }))).toEqual({
      min: 15,
      max: 25,
    })
  })

  it('异常大值拒绝（形状校验）', () => {
    expect(parseSalaryRange('1000-2000K')).toBeNull()
  })

  it('extractJobHardSignals 聚合字段', () => {
    const s = extractJobHardSignals(
      job({ salary: '12-18K', desc: '要求5年以上经验，熟悉项目管理' }),
    )
    expect(s.salaryRange).toEqual({ min: 12, max: 18 })
    expect(s.requiredYears).toBe(5)
    expect(s.haystack).toContain('项目经理')
  })
})

describe('hardRulesFromPolicy / hasAnyHardRule', () => {
  it('从 policy 抽出配置', () => {
    expect(
      hardRulesFromPolicy({
        expectCities: ['武汉'],
        minSalaryK: 15,
        excludeKeywords: ['销售'],
        maxYearsGap: 3,
      }),
    ).toEqual({
      expectCities: ['武汉'],
      minSalaryK: 15,
      excludeKeywords: ['销售'],
      maxYearsGap: 3,
    })
  })

  it('无配置时 hasAnyHardRule 为 false', () => {
    expect(hasAnyHardRule({})).toBe(false)
    expect(hasAnyHardRule({ minSalaryK: 0 })).toBe(false)
    expect(hasAnyHardRule({ minSalaryK: 20 })).toBe(true)
    expect(hasAnyHardRule({ expectCities: ['  '] })).toBe(false)
    expect(hasAnyHardRule({ expectCities: ['武汉'] })).toBe(true)
  })
})
