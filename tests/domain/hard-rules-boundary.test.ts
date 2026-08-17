import { describe, it, expect } from 'vitest'
import { parseSalaryRange, evaluateHardRules } from '../../extension/domain/match-rules'
import type { Job, Profile } from '../../extension/shared/types'

const profile: Profile = {
  syncedAt: 0,
  summary: '10 年项目管理',
  skills: [],
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

describe('parseSalaryRange — 边界证据（审计 3.2 补漏）', () => {
  it('超大数值形态拒绝为非法（999999K / 20-999999K）', () => {
    expect(parseSalaryRange('999999K')).toBeNull()
    expect(parseSalaryRange('20-999999K')).toBeNull()
  })

  it('单值薪资解析为对称区间', () => {
    expect(parseSalaryRange('20K')).toEqual({ min: 20, max: 20 })
  })

  it('日薪/时薪形态拒绝（无法与月薪下限比较，P1-6）', () => {
    expect(parseSalaryRange('100-150元/天')).toBeNull()
    expect(parseSalaryRange('100元/时')).toBeNull()
    expect(parseSalaryRange('100-150元/小时')).toBeNull()
  })
})

describe('evaluateHardRules — 边界证据不足不拒绝（审计 3.2 补漏）', () => {
  it('薪资字段为超大乱码时按缺失处理，不因 minSalaryK 拒绝', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ salary: '999999K' }),
      config: { minSalaryK: 30 },
    })
    expect(r.rejected).toBe(false)
  })

  it('单值薪资低于下限 → 确定性拒绝', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ salary: '20K' }),
      config: { minSalaryK: 30 },
    })
    expect(r.rejected).toBe(true)
    expect(r.rules).toContain('salary_below_floor')
  })

  it('日薪薪资不再按月薪参与硬否（高下限不再误拒，P1-6）', () => {
    const r = evaluateHardRules({
      profile,
      job: job({ salary: '100-150元/天' }),
      config: { minSalaryK: 160 },
    })
    expect(r.rejected).toBe(false)
  })
})