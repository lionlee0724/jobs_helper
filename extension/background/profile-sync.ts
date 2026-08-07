/**
 * 简历画像同步：抓取 raw → LLM 分析 → 写入 profile。
 */
import { type Profile } from '../shared/types'
import {
  buildProfileAnalyzeMessages,
  mergeProfileFromLlm,
  parseProfileAnalyze,
} from '../domain/profile-llm'
import { chatCompletion } from './llm-client'
import * as kv from '../data/kv'
import { appendEvent } from '../data/repos/events'
import { BOSS_URLS } from '../shared/boss-urls'
import { sleep } from './run-context'
import { ensureWorkerTab, execOnWorker } from './tab-runtime'

async function scrapeProfileRaw(workerTabId: number): Promise<{
  rawText: string
  charCount: number
}> {
  const r = await execOnWorker({ op: 'sync_profile' }, workerTabId)
  if (!r.ok || !r.data) {
    throw new Error(r.ok === false ? r.error : '抓取简历失败')
  }
  const data = r.data as Profile & { rawText?: string; _meta?: { charCount?: number } }
  const rawText = data.rawText || ''
  const charCount = data._meta?.charCount ?? rawText.length
  if (rawText.length < 80) {
    throw new Error(`简历文本过短（${charCount} 字），请打开完整在线简历页后重试`)
  }
  return { rawText, charCount }
}

async function analyzeProfileWithLlm(
  rawText: string,
  prev?: Profile | null,
): Promise<Profile> {
  const llm = await kv.getLlmConfig()
  if (!llm.baseUrl?.trim() || !llm.apiKey?.trim() || !llm.model?.trim()) {
    throw new Error('请先配置并保存 LLM（Base URL / API Key / Model），再同步简历')
  }
  const raw = await chatCompletion(llm, buildProfileAnalyzeMessages(rawText), {
    temperature: 0.3,
    timeoutMs: 90_000,
    jsonMode: true,
  })
  const draft = parseProfileAnalyze(raw, rawText)
  return await mergeProfileFromLlm(draft, rawText, prev)
}

export async function syncProfileViaTab(workerTabId: number): Promise<Profile | null> {
  try {
    let scraped: { rawText: string; charCount: number }
    try {
      scraped = await scrapeProfileRaw(workerTabId)
    } catch {
      await chrome.tabs.update(workerTabId, { url: BOSS_URLS.resume })
      await sleep(3500)
      scraped = await scrapeProfileRaw(workerTabId)
    }
    const prev = await kv.getProfile()
    const profile = await analyzeProfileWithLlm(scraped.rawText, prev)
    await kv.setProfile(profile)
    await appendEvent({
      type: 'run_resume',
      payload: {
        kind: 'profile_sync',
        charCount: scraped.charCount,
        analyzedByLlm: true,
      },
    }).catch(() => undefined)
    return profile
  } catch (e) {
    await appendEvent({
      type: 'error',
      payload: {
        op: 'profile_sync',
        error: e instanceof Error ? e.message : String(e),
      },
    }).catch(() => undefined)
    return kv.getProfile()
  }
}

export async function manualSyncProfile(tabId?: number): Promise<Profile> {
  const id = tabId ?? (await ensureWorkerTab())
  // 始终导航到简历页，保证抓全量
  await chrome.tabs.update(id, { url: BOSS_URLS.resume })
  await sleep(3500)
  // 再等一轮，给 SPA 渲染
  await sleep(1500)

  const scraped = await scrapeProfileRaw(id)
  // 若偏短，滚动后再抓一次（content 侧已尝试展开）
  if (scraped.charCount < 500) {
    await sleep(2000)
    const again = await scrapeProfileRaw(id)
    if (again.charCount > scraped.charCount) {
      scraped.rawText = again.rawText
      scraped.charCount = again.charCount
    }
  }

  const prev = await kv.getProfile()
  const profile = await analyzeProfileWithLlm(scraped.rawText, prev)
  await kv.setProfile(profile)
  await appendEvent({
    type: 'run_resume',
    payload: {
      kind: 'profile_sync_manual',
      charCount: scraped.charCount,
      analyzedByLlm: true,
      skills: profile.skills.length,
    },
  }).catch(() => undefined)
  return profile
}
