import { describe, expect, it } from 'vitest'
import {
  decideJobMatch,
  DEFAULT_MIN_MATCH_SCORE,
  normalizeExcludeKeywords,
  normalizeExpectCities,
  normalizeMaxYearsGap,
  normalizeMinMatchScore,
  normalizeMinSalaryK,
  resolveMinScore,
  summarizeHardRulesForUi,
} from '../../extension/domain/match-decision'
import { hardRulesFromPolicy } from '../../extension/domain/match-rules'
import type { Job, Profile } from '../../extension/shared/types'

const profile: Profile = {
  syncedAt: 1,
  summary: '十年项目管理',
  skills: ['项目管理'],
  years: '10年',
}

const job = (over: Partial<Job> = {}): Job => ({
  id: '1',
  title: '项目经理',
  company: 'A',
  desc: '负责交付',
  source: 'current',
  ...over,
})

describe('normalizeExcludeKeywords', () => {
  it('trim、去空、去重（大小写不敏感）', () => {
    expect(normalizeExcludeKeywords(' 外包 , 中介,,外包, 外包 ')).toEqual(['外包', '中介'])
    expect(normalizeExcludeKeywords(['销售', ' 销售 ', '中介', ''])).toEqual(['销售', '中介'])
    expect(normalizeExcludeKeywords('外包，中介')).toEqual(['外包', '中介'])
    expect(normalizeExcludeKeywords(undefined)).toEqual([])
    expect(normalizeExcludeKeywords('')).toEqual([])
  })
})

describe('normalizeExpectCities / salary / yearsGap', () => {
  it('城市 CSV 归一；空 → undefined', () => {
    expect(normalizeExpectCities(' 上海 , 杭州,,上海 ')).toEqual(['上海', '杭州'])
    expect(normalizeExpectCities('')).toBeUndefined()
    expect(normalizeExpectCities(undefined)).toBeUndefined()
  })

  it('最低薪资钳制；空/非法 → undefined', () => {
    expect(normalizeMinSalaryK('20')).toBe(20)
    expect(normalizeMinSalaryK(0)).toBeUndefined()
    expect(normalizeMinSalaryK('')).toBeUndefined()
    expect(normalizeMinSalaryK(1500)).toBe(999)
  })

  it('年限差距允许 0；空 → undefined', () => {
    expect(normalizeMaxYearsGap(0)).toBe(0)
    expect(normalizeMaxYearsGap('3')).toBe(3)
    expect(normalizeMaxYearsGap('')).toBeUndefined()
    expect(normalizeMaxYearsGap(-1)).toBeUndefined()
    expect(normalizeMaxYearsGap(99)).toBe(40)
  })

  it('summarizeHardRulesForUi', () => {
    expect(summarizeHardRulesForUi({})).toContain('无硬否')
    expect(
      summarizeHardRulesForUi({
        expectCities: ['上海'],
        minSalaryK: 25,
        maxYearsGap: 2,
        excludeKeywords: ['外包', '中介'],
      }),
    ).toMatch(/城市 上海/)
  })
})

describe('resolveMinScore / normalizeMinMatchScore', () => {
  it('空值生效默认 50', () => {
    expect(DEFAULT_MIN_MATCH_SCORE).toBe(50)
    expect(resolveMinScore({ enabled: false })).toBe(50)
    expect(resolveMinScore({ enabled: false, minMatchScore: undefined })).toBe(50)

    expect(normalizeMinMatchScore(undefined)).toBeUndefined()
    expect(normalizeMinMatchScore('')).toBeUndefined()
  })

  it('非法输入钳制 0–100', () => {
    expect(resolveMinScore({ enabled: false, minMatchScore: 150 })).toBe(100)
    expect(resolveMinScore({ enabled: false, minMatchScore: -3 })).toBe(0)
    expect(normalizeMinMatchScore(150)).toBe(100)
    expect(normalizeMinMatchScore(-1)).toBe(0)
    expect(normalizeMinMatchScore(72.9)).toBe(72)
  })
})

describe('decideJobMatch — 排除词硬否与低分', () => {
  it('AC-M2：排除词「外包,中介」后，标题含外包走硬否', () => {
    const excludes = normalizeExcludeKeywords('外包,中介')
    const d = decideJobMatch({
      profile,
      job: job({ title: '外包项目经理' }),
      policy: { enabled: true, matchMode: 'balanced', excludeKeywords: excludes },
      llm: { suitable: true, score: 90, tier: 'strong', reasons: ['本可合适'], confidence: 0.9 },
      hardRules: { excludeKeywords: excludes },
    })
    expect(d.suitable).toBe(false)
    expect(d.via).toBe('hard_reject')
    expect(d.hardRules).toContain('exclude_keyword')
    expect(d.reasons.some((r) => r.includes('排除词'))).toBe(true)
  })

  it('城市硬否：期望上海，职位北京 → hard_reject', () => {
    const cities = normalizeExpectCities('上海')!
    const policy = { enabled: true, matchMode: 'balanced' as const, expectCities: cities }
    const d = decideJobMatch({
      profile,
      job: job({ city: '北京', title: '项目经理' }),
      policy,
      llm: { suitable: true, score: 90, tier: 'strong', reasons: ['合适'], confidence: 0.9 },
      hardRules: hardRulesFromPolicy(policy),
    })
    expect(d.suitable).toBe(false)
    expect(d.via).toBe('hard_reject')
  })

  it('清空城市后不再城市硬否', () => {
    const policy = { enabled: true, matchMode: 'balanced' as const, expectCities: undefined }
    const d = decideJobMatch({
      profile,
      job: job({ city: '北京' }),
      policy,
      llm: { suitable: true, score: 90, tier: 'strong', reasons: ['合适'], confidence: 0.9 },
      hardRules: hardRulesFromPolicy(policy),
    })
    expect(d.via).not.toBe('hard_reject')
    expect(d.suitable).toBe(true)
  })

  it('AC-M3：最低分 90 时综合分 70 → suitable=false', () => {
    const d = decideJobMatch({
      profile,
      job: job({
        title: '初级会计',
        desc: '做账报税',
      }),
      policy: { enabled: true, matchMode: 'llm_only', minMatchScore: 90 },
      llm: {
        suitable: true,
        score: 70,
        tier: 'moderate',
        reasons: ['方向部分相关'],
        confidence: 0.6,
      },
    })
    expect(d.score).toBe(70)
    expect(d.suitable).toBe(false)
    expect(d.via).not.toBe('hard_reject')
  })
})
