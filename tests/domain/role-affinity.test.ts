import { describe, it, expect } from 'vitest'
import {
  expandRoleAliases,
  profileRoleSeeds,
  scoreTitleAffinity,
  titleAffinityBonus,
  expandKeywordsWithRoleAliases,
} from '../../extension/domain/role-affinity'
import { decideJobMatch } from '../../extension/domain/match-decision'
import { extractProfileKeywords, countKeywordHits } from '../../extension/domain/keyword-match'
import type { Job, Profile } from '../../extension/shared/types'

describe('role-affinity', () => {
  it('项目经理 扩展到 交付/实施 同族', () => {
    const a = expandRoleAliases('项目经理')
    expect(a).toEqual(expect.arrayContaining(['交付经理', '实施经理', 'PMO']))
  })

  it('标题亲和：期望项目经理 vs 交付经理标题', () => {
    const profile: Profile = {
      syncedAt: 1,
      summary: '十年项目经理',
      skills: ['项目管理'],
      expectRoles: ['项目经理'],
    }
    const aff = scoreTitleAffinity(profile, { title: '交付经理（智慧城市）' })
    expect(aff.score).toBeGreaterThanOrEqual(0.75)
    expect(aff.matched.length).toBeGreaterThan(0)
    expect(titleAffinityBonus(aff, 45)).toBeGreaterThanOrEqual(5)
    // 过低不救；已高分不叠
    expect(titleAffinityBonus(aff, 30)).toBe(0)
    expect(titleAffinityBonus(aff, 81)).toBe(0)
  })

  it('关键词扩展后，交付岗能命中项目经理画像词', () => {
    const profile: Profile = {
      syncedAt: 1,
      summary: '项目交付专家',
      skills: ['项目管理'],
      expectRoles: ['项目经理'],
    }
    const kws = extractProfileKeywords(profile)
    expect(kws.some((k) => /交付|实施|PMO|项目/.test(k))).toBe(true)
    const hits = countKeywordHits(profile, {
      title: '交付经理',
      company: '某司',
      desc: '负责项目交付与实施',
      salary: '20-35K',
      city: '上海',
    })
    expect(hits.hitCount).toBeGreaterThan(0)
  })

  it('balanced：中等 LLM + 标题亲和可抬过默认阈值边缘', () => {
    const profile: Profile = {
      syncedAt: 1,
      summary: '十年项目经理，智慧城市交付',
      skills: ['项目管理', '交付'],
      expectRoles: ['项目经理'],
      years: '10年',
    }
    const job: Job = {
      id: '1',
      title: '交付经理',
      company: 'A',
      desc: '负责智慧城市项目交付与客户对接',
      source: 'current',
    }
    const d = decideJobMatch({
      profile,
      job,
      policy: { enabled: true, matchMode: 'balanced', minMatchScore: 50, matchLlmWeight: 0.75 },
      llm: {
        suitable: true,
        score: 52,
        tier: 'weak',
        reasons: ['方向接近'],
        confidence: 0.7,
      },
    })
    // 无亲和时约 52*0.75 + kw*0.25；有亲和应 ≥ 无亲和且更易过线
    expect(d.score).toBeGreaterThanOrEqual(50)
    expect(d.reasons.some((r) => r.includes('标题角色亲和') || r.includes('亲和'))).toBe(true)
  })

  it('expandKeywordsWithRoleAliases 去重', () => {
    const out = expandKeywordsWithRoleAliases(['项目经理', '项目管理'])
    const lower = out.map((x) => x.toLowerCase())
    expect(new Set(lower).size).toBe(lower.length)
  })

  it('profileRoleSeeds 从 expectRoles 取种', () => {
    expect(
      profileRoleSeeds({
        summary: '',
        skills: [],
        expectRoles: ['售前顾问'],
      }),
    ).toContain('售前顾问')
  })
})
