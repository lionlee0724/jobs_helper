import type { Profile } from '../shared/types'
import { extractJson } from './match-llm'
import { analyzePastJobs } from '../data/repos/jobs'

/** 从 BOSS 简历页全文归纳结构化画像（禁止照抄噪声原文） */

export function buildProfileAnalyzeMessages(rawText: string) {
  const system = `你是求职顾问，任务是把招聘网站「页面抓取的杂乱全文」改写成干净的求职画像。

硬性要求：
1. 禁止把页面噪声写进 summary：头像提示、编辑按钮、手机号/邮箱打码、页面操作文案、「真实头像可以吸引…」等。
2. 禁止把 raw 文本原样或几乎原样粘贴为 summary；必须用自己的话重写。
3. summary 用 3~6 句中文，约 120~280 字：身份定位、年限/学历、核心领域、代表业绩（量化优先）、求职方向。
4. skills 为 8~20 个短关键词（如「项目管理」「智慧城市」），不要长句。
5. highlights 为 3~6 条「可验证亮点」，每条一句，含数字更好。
6. 只输出一个 JSON 对象，不要 markdown 代码块，不要其它说明。

JSON 字段：
{
  "summary": string,
  "skills": string[],
  "years": string,
  "education": string,
  "expectRoles": string[],
  "highlights": string[]
}`

  const cleaned = preprocessResumeText(rawText)
  const user = `请根据下列简历相关文本归纳画像（已做初步去噪，仍可能有杂质）：

---
${cleaned.slice(0, 16000)}
---`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

/** 抓取文本预清洗，减少模型照抄噪声（只删固定噪声短语，不吞正文） */
export function preprocessResumeText(raw: string): string {
  let t = raw
  const drop = [
    /真实头像可以吸引更多招聘者[，,。.！!]*/g,
    /请使用白底或蓝底证件照[凸显简历专业性]*/g,
    /凸显简历专业性/g,
    /点击编辑/g,
    /立即沟通/g,
    /在线简历|附件简历|预览简历|下载简历/g,
    /\d{3}\*{4,}\d{4}/g,
    /[\w.*+-]+@[\w*.-]+\.\w+/gi,
  ]
  for (const p of drop) t = t.replace(p, ' ')
  t = t.replace(/\s{2,}/g, ' ').trim()
  return t
}

export type ProfileLlmDraft = {
  summary: string
  skills: string[]
  years?: string
  education?: string
  expectRoles?: string[]
  highlights?: string[]
}

export function parseProfileAnalyze(raw: string, rawTextForCheck?: string): ProfileLlmDraft {
  const json = extractJson(raw)
  if (!json || typeof json !== 'object') {
    throw new Error(
      `简历 LLM 结果无法解析为 JSON。模型原文前 200 字：${raw.trim().slice(0, 200)}`,
    )
  }
  const o = json as Record<string, unknown>
  const skills = Array.isArray(o.skills)
    ? o.skills.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 40)
    : []
  const expectRoles = Array.isArray(o.expectRoles)
    ? o.expectRoles.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8)
    : []
  const highlights = Array.isArray(o.highlights)
    ? o.highlights.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 12)
    : []
  let summary = String(o.summary || '').trim()
  if (summary.length < 40) {
    throw new Error(`LLM 摘要过短（${summary.length} 字），请重试或检查模型`)
  }

  // 拒绝「基本是原文粘贴」
  if (rawTextForCheck && looksLikeRawDump(summary, rawTextForCheck)) {
    throw new Error(
      'LLM 输出疑似照抄页面原文（含头像提示/打码联系方式等噪声）。请点「测试 LLM」确认连通后重试归纳，或换模型。',
    )
  }
  if (/真实头像可以吸引|请使用白底|点击编辑/.test(summary)) {
    throw new Error('LLM 摘要仍含页面噪声文案，已拒绝写入。请重试。')
  }

  // 过长则截断到合理画像长度
  if (summary.length > 800) {
    summary = summary.slice(0, 800) + '…'
  }

  return {
    summary,
    skills,
    years: o.years != null ? String(o.years).trim() : undefined,
    education: o.education != null ? String(o.education).trim() : undefined,
    expectRoles,
    highlights,
  }
}

function looksLikeRawDump(summary: string, raw: string): boolean {
  if (summary.length > 500 && summary.length > raw.length * 0.5) return true
  // 与原文前 120 字高度重合
  const head = raw.replace(/\s+/g, '').slice(0, 80)
  const s = summary.replace(/\s+/g, '')
  if (head.length >= 40 && s.includes(head.slice(0, 40))) return true
  return false
}

export async function mergeProfileFromLlm(
  draft: ProfileLlmDraft,
  rawText: string,
  prev?: Profile | null,
): Promise<Profile> {
  let skills = draft.skills.length ? draft.skills : prev?.skills ?? []
  let highlights = draft.highlights?.length ? draft.highlights : prev?.highlights ?? []
  let expectRoles = draft.expectRoles?.length ? draft.expectRoles : prev?.expectRoles

  // Analyze past applications and fold success signals into profile
  try {
    const analysis = await analyzePastJobs()
    if (analysis.profileInsights.commonKeywords.length) {
      skills = [...new Set([...skills, ...analysis.profileInsights.commonKeywords.map((k) => k.trim()).filter(Boolean)])].slice(0, 30)
    }
    if (analysis.profileInsights.successSignals.length) {
      const extra = analysis.profileInsights.successSignals
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 5)
      highlights = [...new Set([...(highlights || []), ...extra])].slice(0, 12)
    }
    // Prefer roles that historically matched
    if (analysis.stats.opened > 0 && analysis.profileInsights.commonKeywords.length) {
      const roleHints = analysis.profileInsights.commonKeywords
        .filter((k) => /经理|主管|总监|工程师|专员|顾问|销售|项目/.test(k))
        .slice(0, 5)
      if (roleHints.length) {
        expectRoles = [...new Set([...(expectRoles || []), ...roleHints])].slice(0, 10)
      }
    }
  } catch (e) {
    console.warn('Past jobs analysis failed for profile:', e)
  }

  return {
    syncedAt: Date.now(),
    summary: draft.summary,
    skills,
    rawText,
    years: draft.years || prev?.years,
    education: draft.education || prev?.education,
    expectRoles,
    highlights,
    analyzedByLlm: true,
  }
}

// keep sync wrapper for callers that cannot await yet
export function mergeProfileFromLlmSync(
  draft: ProfileLlmDraft,
  rawText: string,
  prev?: Profile | null,
): Profile {
  return {
    syncedAt: Date.now(),
    summary: draft.summary,
    skills: draft.skills.length ? draft.skills : prev?.skills ?? [],
    rawText,
    years: draft.years || prev?.years,
    education: draft.education || prev?.education,
    expectRoles: draft.expectRoles?.length ? draft.expectRoles : prev?.expectRoles,
    highlights: draft.highlights?.length ? draft.highlights : prev?.highlights,
    analyzedByLlm: true,
  }
}

