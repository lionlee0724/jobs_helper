import { describe, expect, it } from 'vitest'
import {
  parseProfileAnalyze,
  preprocessResumeText,
} from '../../extension/domain/profile-llm'

describe('parseProfileAnalyze', () => {
  it('parses full draft', () => {
    const r = parseProfileAnalyze(
      JSON.stringify({
        summary:
          '十年以上项目管理经验，擅长智慧城市与政企资源整合，带过千万级项目交付，求职方向为项目管理类岗位。',
        skills: ['项目管理', '智慧城市', '政企合作'],
        years: '10年以上',
        education: '本科',
        expectRoles: ['项目经理'],
        highlights: ['千万级项目交付'],
      }),
    )
    expect(r.skills).toContain('项目管理')
    expect(r.years).toBe('10年以上')
  })
})

describe('preprocessResumeText', () => {
  it('drops avatar noise', () => {
    const t = preprocessResumeText(
      '真实头像可以吸引更多招聘者，请使用白底证件照 李某 项目管理专家',
    )
    expect(t.includes('真实头像')).toBe(false)
    expect(t.includes('项目管理')).toBe(true)
  })
})

describe('reject raw dump', () => {
  it('throws when summary copies page noise', () => {
    const raw =
      '真实头像可以吸引更多招聘者，请使用白底或蓝底证件照凸显简历专业性编辑 李某某 10年以上经验本科离职-随时到岗'
    expect(() =>
      parseProfileAnalyze(
        JSON.stringify({
          summary: raw + ' ' + raw,
          skills: ['项目管理'],
          highlights: ['业绩'],
        }),
        raw,
      ),
    ).toThrow()
  })
})