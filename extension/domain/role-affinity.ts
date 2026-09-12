/**
 * 岗位角色亲和 / 可迁移别名。
 *
 * 背景：用户反馈「其实适合我的岗」常被压低分——常见原因是标题用词与简历
 * expectRoles/skills 字面不一致（交付经理 vs 项目经理、售前 vs 解决方案）。
 * 本模块提供确定性别名扩展与标题亲和分，供关键词通道与综合决策使用。
 *
 * 原则：
 * - 只做「同族扩张」，不做跨职能硬映射（如 项目经理 ↛ Java 开发）
 * - 纯函数；证据不足时亲和分 = 0，不误抬
 */

import type { Job, Profile } from '../shared/types'

/** 同族角色簇：簇内任意词互相视作可迁移别名 */
const ROLE_CLUSTERS: string[][] = [
  ['项目经理', '项目主管', '项目总监', '交付经理', '交付主管', '实施经理', '实施顾问', '项目管理', 'PMO', 'Scrum Master', '敏捷教练'],
  ['产品经理', '产品总监', '产品专家', '产品负责人', '产品', '需求分析师', '业务分析师'],
  ['UI', 'UX', '用户体验', '交互设计', 'UI设计师', '视觉设计', '体验设计'],
  ['售前', '售前经理', '售前顾问', '解决方案', '解决方案经理', '方案经理', '技术支持经理', '售前专家', '解决方案架构师'],
  ['销售', '销售经理', '客户经理', '商务', '商务经理', '大客户', 'BD', '渠道销售', '客户成功', 'CSM'],
  ['运维', '运维工程师', 'SRE', '系统运维', '网络运维', 'DevOps', '云原生', 'K8s', '基础架构', '系统工程师'],
  ['开发', '研发', '工程师', '后端', '前端', '全栈', '软件工程师', '研发工程师'],
  ['后端', 'Java', 'Golang', 'Go', 'C++', 'Python', 'Node.js', '服务端', '后端开发', '后端工程师'],
  ['前端', 'React', 'Vue', 'TypeScript', 'Web前端', '前端开发', '小程序', '全栈', '前端工程师'],
  ['移动端', 'Android', 'iOS', 'Flutter', '安卓', '客户端', '移动开发'],
  ['算法', '算法工程师', '大模型', 'LLM', 'AIGC', 'NLP', 'CV', '机器学习', '深度学习', '人工智能', 'AI工程师'],
  ['测试', '测试工程师', 'QA', '质量保障', '自动化测试', '测试开发', '测开'],
  ['数据', '数据分析', '数据开发', '数据工程师', 'BI', '数仓', 'ETL', '大数据', '数据专家'],
  ['架构师', '系统架构师', '技术专家', '研发主管', '技术总监', '技术负责人', 'Team Leader'],
  ['运营', '运营经理', '用户运营', '内容运营', '活动运营', '产品运营', '增长', '新媒体运营'],
  ['人事', 'HR', '招聘', '人力资源', 'HRBP', '招聘顾问', '招聘专家'],
  ['财务', '会计', '出纳', '审计', '财务主管', '财务分析'],
]

function normalizeToken(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/** 建立 token → 同簇全部 token（含自身） */
function buildAliasIndex(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const cluster of ROLE_CLUSTERS) {
    const norms = cluster.map(normalizeToken)
    for (let i = 0; i < cluster.length; i++) {
      const key = norms[i]
      const prev = map.get(key) || []
      const merged = [...new Set([...prev, ...cluster])]
      map.set(key, merged)
    }
  }
  return map
}

const ALIAS_INDEX = buildAliasIndex()

/** 单个词的同族别名（含自身）；无簇则仅自身 */
export function expandRoleAliases(term: string): string[] {
  const t = (term || '').trim()
  if (!t) return []
  const key = normalizeToken(t)
  const hit = ALIAS_INDEX.get(key)
  if (hit) return hit
  // 子串：term 含簇内词，或簇内词含 term（长度≥2）
  const extra: string[] = [t]
  for (const cluster of ROLE_CLUSTERS) {
    for (const c of cluster) {
      const cn = normalizeToken(c)
      if (cn.length < 2) continue
      if (key.includes(cn) || cn.includes(key)) {
        for (const x of cluster) extra.push(x)
      }
    }
  }
  return [...new Set(extra)]
}

/**
 * 从画像抽出「角色向」种子：expectRoles + 技能/亮点中像岗位名的短词。
 */
export function profileRoleSeeds(profile: Pick<Profile, 'expectRoles' | 'skills' | 'highlights' | 'summary'>): string[] {
  const raw: string[] = []
  for (const r of profile.expectRoles || []) raw.push(r)
  for (const s of profile.skills || []) {
    if (/经理|主管|总监|顾问|专员|工程师|销售|产品|项目|交付|实施|运营|售前/.test(s)) {
      raw.push(s)
    }
  }
  // summary 里偶发「十年项目经理经验」——抽 2–8 字中文岗位片段（弱信号）
  const sum = profile.summary || ''
  const m = sum.match(/[\u4e00-\u9fff]{0,4}(?:经理|主管|总监|顾问|工程师|专员)/g)
  if (m) for (const x of m.slice(0, 4)) raw.push(x)

  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const t = (item || '').trim()
    if (!t || t.length < 2 || t.length > 16) continue
    const k = normalizeToken(t)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

/**
 * 扩展后的关键词列表：原词 + 角色别名（去重、长度过滤与 keyword-match 一致）。
 */
export function expandKeywordsWithRoleAliases(keywords: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (t: string) => {
    const s = (t || '').trim()
    if (!s || s.length < 2 || s.length > 20) return
    if (/^[0-9.]+$/.test(s)) return
    const k = s.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(s)
  }
  for (const kw of keywords) {
    push(kw)
    for (const a of expandRoleAliases(kw)) push(a)
  }
  return out
}

export type TitleAffinity = {
  /** 0–1：标题与期望角色的亲和 */
  score: number
  /** 命中的种子或别名 */
  matched: string[]
}

/**
 * 职位标题 vs 画像角色亲和。
 * 直接命中种子 → 1.0；别名命中 → 0.75；无 → 0。
 */
export function scoreTitleAffinity(
  profile: Pick<Profile, 'expectRoles' | 'skills' | 'highlights' | 'summary'>,
  job: Pick<Job, 'title'>,
): TitleAffinity {
  const title = (job.title || '').trim()
  if (!title) return { score: 0, matched: [] }
  const hay = normalizeToken(title)
  const seeds = profileRoleSeeds(profile)
  if (!seeds.length) return { score: 0, matched: [] }

  const direct: string[] = []
  const alias: string[] = []
  for (const seed of seeds) {
    const sn = normalizeToken(seed)
    if (sn.length >= 2 && (hay.includes(sn) || sn.includes(hay))) {
      direct.push(seed)
      continue
    }
    for (const a of expandRoleAliases(seed)) {
      const an = normalizeToken(a)
      if (an.length >= 2 && hay.includes(an)) {
        alias.push(a)
        break
      }
    }
  }

  if (direct.length) {
    return { score: 1, matched: [...new Set(direct)].slice(0, 6) }
  }
  if (alias.length) {
    return { score: 0.75, matched: [...new Set(alias)].slice(0, 6) }
  }
  return { score: 0, matched: [] }
}

/**
 * 标题亲和对综合分的加分（0–8）。
 * 只在「边缘可投」区间生效：抬过默认阈值附近的可迁移岗，
 * 不改写已明显偏低（reject）或已明显偏高（strong）的综合分合同。
 */
export function titleAffinityBonus(affinity: TitleAffinity, baseScore: number): number {
  if (affinity.score <= 0) return 0
  // 过低：方向不符，不救；过高：已过线，不再叠亲和分（保留 hybrid 权重合同）
  if (baseScore < 40 || baseScore >= 70) return 0
  if (affinity.score >= 1) return 8
  if (affinity.score >= 0.75) return 5
  return 0
}
