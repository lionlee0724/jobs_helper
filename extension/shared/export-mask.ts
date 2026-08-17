import type { LlmConfig } from './types'

/**
 * export/all 导出前的敏感字段脱敏。
 *
 * 背景：chrome.storage.local 是扩展私有区，但导出文件会离开浏览器（分享/备份），
 * 因此 `llm.apiKey` 一律掩码——非空 → '***'，空 → 保持空串。
 * 除 llm.apiKey 外的字段原样透传（纯函数，便于测试）。
 */
export function maskKvForExport<T>(
  kv: T & { llm?: LlmConfig | null },
): T & { llm?: LlmConfig | null } {
  if (!kv.llm) return kv
  return { ...kv, llm: { ...kv.llm, apiKey: kv.llm.apiKey ? '***' : '' } }
}