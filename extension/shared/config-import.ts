/**
 * 配置导入：解析「导出 JSON」中的可恢复配置（policy / llm / profile / messageAssist）。
 *
 * 设计约束：
 * - 只恢复配置，不写 runState / 不恢复 jobs/events（重装后分析库可空）
 * - 导出脱敏后的 apiKey（***）不得覆盖本机已有密钥
 * - 纯函数，便于单测；写库由 SW 调用方完成
 */

import type { LlmConfig, MessageAssistConfig, Policy, Profile } from './types'
import { DEFAULT_LLM, DEFAULT_POLICY } from './types'

const DEFAULT_MESSAGE_ASSIST: MessageAssistConfig = {
  enabled: true,
  batchSize: 5,
  autonomy: 'graded',
}

export type ImportableConfig = {
  policy?: Policy
  llm?: LlmConfig
  profile?: Profile | null
  messageAssist?: MessageAssistConfig
}

export type ParsedImport =
  | {
      ok: true
      config: ImportableConfig
      /** 人类可读摘要，供 UI toast */
      summary: string
      /** 源文件 exportedAt（若有） */
      exportedAt?: number
      warnings: string[]
    }
  | { ok: false; error: string }

const MASKED_KEYS = new Set(['***', '••••', '****', '[redacted]', 'redacted'])

export function isMaskedApiKey(v: unknown): boolean {
  if (v == null) return false
  const s = String(v).trim().toLowerCase()
  return MASKED_KEYS.has(s) || /^\*+$/.test(s)
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function pickKvRoot(raw: unknown): {
  kv: Record<string, unknown> | null
  exportedAt?: number
  error?: string
} {
  const root = asObject(raw)
  if (!root) return { kv: null, error: '导入文件不是 JSON 对象' }

  const exportedAt =
    typeof root.exportedAt === 'number' && Number.isFinite(root.exportedAt)
      ? root.exportedAt
      : undefined

  // 完整 export/all 载荷
  if (root.kv != null) {
    const kv = asObject(root.kv)
    if (!kv) return { kv: null, error: '载荷 kv 字段无效' }
    return { kv, exportedAt }
  }

  // 仅配置：{ policy, llm, profile, messageAssist }
  if (
    root.policy != null ||
    root.llm != null ||
    root.profile != null ||
    root.messageAssist != null
  ) {
    return { kv: root, exportedAt }
  }

  return {
    kv: null,
    error: '未识别的备份格式：需要 export/all 的 JSON，或含 policy/llm/profile 的配置对象',
  }
}

function normalizePolicy(raw: unknown): Policy | undefined {
  const o = asObject(raw)
  if (!o) return undefined
  // 浅合并默认值，避免缺字段导致策略不可用
  return { ...DEFAULT_POLICY, ...(o as unknown as Policy) }
}

function normalizeLlm(raw: unknown): LlmConfig | undefined {
  const o = asObject(raw)
  if (!o) return undefined
  return {
    ...DEFAULT_LLM,
    baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl : DEFAULT_LLM.baseUrl,
    apiKey: typeof o.apiKey === 'string' ? o.apiKey : DEFAULT_LLM.apiKey,
    model: typeof o.model === 'string' ? o.model : DEFAULT_LLM.model,
  }
}

function normalizeProfile(raw: unknown): Profile | null | undefined {
  if (raw === null) return null
  const o = asObject(raw)
  if (!o) return undefined
  const summary = typeof o.summary === 'string' ? o.summary : ''
  const skills = Array.isArray(o.skills)
    ? o.skills.map(String).map((s) => s.trim()).filter(Boolean)
    : []
  // 空画像无意义，跳过
  if (!summary.trim() && skills.length === 0) return undefined
  return {
    syncedAt:
      typeof o.syncedAt === 'number' && Number.isFinite(o.syncedAt)
        ? o.syncedAt
        : Date.now(),
    summary,
    skills,
    rawText: typeof o.rawText === 'string' ? o.rawText : undefined,
    years: o.years != null ? String(o.years) : undefined,
    education: o.education != null ? String(o.education) : undefined,
    expectRoles: Array.isArray(o.expectRoles)
      ? o.expectRoles.map(String).filter(Boolean)
      : undefined,
    highlights: Array.isArray(o.highlights)
      ? o.highlights.map(String).filter(Boolean)
      : undefined,
    analyzedByLlm: Boolean(o.analyzedByLlm),
  }
}

function normalizeMessageAssist(raw: unknown): MessageAssistConfig | undefined {
  const o = asObject(raw)
  if (!o) return undefined
  const autonomy =
    o.autonomy === 'resume_only' || o.autonomy === 'full_auto' || o.autonomy === 'graded'
      ? o.autonomy
      : DEFAULT_MESSAGE_ASSIST.autonomy
  const batchRaw = typeof o.batchSize === 'number' ? o.batchSize : DEFAULT_MESSAGE_ASSIST.batchSize
  const batchSize = Math.max(1, Math.min(20, Math.floor(batchRaw || 5)))
  return {
    enabled: o.enabled !== false,
    autonomy,
    batchSize,
  }
}

/**
 * 解析导入 JSON 文本或已 parse 的对象。
 * 不读本机存储；apiKey 掩码处理在 apply 阶段结合 currentLlm 完成。
 */
export function parseConfigImport(input: unknown): ParsedImport {
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch {
      return { ok: false, error: 'JSON 解析失败：请确认是本扩展导出的备份文件' }
    }
  }

  const picked = pickKvRoot(raw)
  if (!picked.kv) return { ok: false, error: picked.error || '无效备份' }

  const policy = normalizePolicy(picked.kv.policy)
  const llm = normalizeLlm(picked.kv.llm)
  const profile = normalizeProfile(picked.kv.profile)
  const messageAssist = normalizeMessageAssist(picked.kv.messageAssist)

  const config: ImportableConfig = {}
  const parts: string[] = []
  const warnings: string[] = []

  if (policy) {
    config.policy = policy
    parts.push('策略')
  }
  if (llm) {
    config.llm = llm
    parts.push('LLM')
    if (isMaskedApiKey(llm.apiKey) || !llm.apiKey) {
      warnings.push('备份中 API Key 已脱敏或为空，将保留本机现有 Key')
    }
  }
  if (profile !== undefined) {
    config.profile = profile
    parts.push(profile ? '画像' : '画像(清空)')
  }
  if (messageAssist) {
    config.messageAssist = messageAssist
    parts.push('消息助手')
  }

  if (!parts.length) {
    return { ok: false, error: '备份中没有可导入的配置字段（policy/llm/profile/messageAssist）' }
  }

  return {
    ok: true,
    config,
    summary: `将导入：${parts.join('、')}`,
    exportedAt: picked.exportedAt,
    warnings,
  }
}

/**
 * 合并 LLM：备份 Key 为掩码/空时保留 current。
 */
export function mergeLlmForImport(
  incoming: LlmConfig | undefined,
  current: LlmConfig | null | undefined,
): LlmConfig | undefined {
  if (!incoming) return undefined
  const cur = current ?? DEFAULT_LLM
  if (isMaskedApiKey(incoming.apiKey) || !String(incoming.apiKey || '').trim()) {
    return {
      baseUrl: incoming.baseUrl || cur.baseUrl,
      model: incoming.model || cur.model,
      apiKey: cur.apiKey || '',
    }
  }
  return incoming
}
