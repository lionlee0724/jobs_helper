/**
 * Tab 运行时：消息发送、导航、content 保活、列表页锁定、聊天 tab 生命周期。
 */
import type { ContentCommand, ContentResult } from '../shared/messages'
import * as kv from '../data/kv'
import { appendEvent } from '../data/repos/events'
import {
  BOSS_URLS,
  detectSourceFromUrl,
  isChatUrl,
  isJobDetailUrl,
  isJobListUrl,
  isResumeUrl,
  isSamePageUrl,
  normalizePageUrl,
} from '../shared/boss-urls'
import { isStillRunning, sleep } from './run-context'
import { isContentBridgeDead } from './run-guards'

export async function ensureWorkerTab(): Promise<number> {
  const state = await kv.getRunState()
  if (state.status === 'running' && state.workerTabId) {
    try {
      const t = await chrome.tabs.get(state.workerTabId)
      if (t.id != null) return t.id
    } catch {
      /* recreate */
    }
  }

  // 优先复用当前激活的职位列表页
  const active = await chrome.tabs.query({ active: true, currentWindow: true })
  const activeTab = active[0]
  if (activeTab?.id != null && isJobListUrl(activeTab.url)) {
    return activeTab.id
  }

  const tabs = await chrome.tabs.query({
    url: ['*://*.zhipin.com/*', '*://*.bosszhipin.com/*'],
  })
  const listTab = tabs.find((t) => t.id != null && isJobListUrl(t.url))
  if (listTab?.id != null) return listTab.id
  if (tabs[0]?.id != null) return tabs[0].id

  const tab = await chrome.tabs.create({
    url: BOSS_URLS.recommend,
    active: false,
  })
  if (tab.id == null) throw new Error('无法创建工作标签')
  await waitTabComplete(tab.id)
  return tab.id
}

type PinnedList = { tabId: number; listUrl: string; listLabel: string }

/**
 * 启动时解析「当前职位分类」列表页。
 * 优先：当前/最近焦点窗口的激活列表 tab，且分类标签非空。
 * 其次：所有 zhipin 列表 tab 中，优先「非推荐」高亮的那个（用户常停在项目经理）。
 * 否则：任意列表；最后才兜底推荐页。
 */
export async function resolveCurrentListTab(): Promise<
  | { ok: true; tabId: number; listUrl: string; listLabel: string }
  | { ok: false; error: string }
> {
  const candidates: PinnedList[] = []

  const pushTab = (t: chrome.tabs.Tab) => {
    if (t.id == null || !isJobListUrl(t.url)) return
    if (candidates.some((c) => c.tabId === t.id)) return
    const listUrl = normalizePageUrl(t.url!)
    // 启动路径只用 URL 推断标签，避免对每个 tab waitContentReady 卡住侧栏
    const src = detectSourceFromUrl(listUrl)
    const listLabel =
      src === 'recommend'
        ? '推荐职位'
        : src === 'expect2'
          ? '求职期望2'
          : src === 'expect1'
            ? '求职期望1'
            : '当前职位列表'
    candidates.push({ tabId: t.id, listUrl, listLabel })
  }

  // 1) 当前窗口 + 最近焦点窗口的激活 tab
  for (const q of [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true },
  ] as chrome.tabs.QueryInfo[]) {
    try {
      const active = await chrome.tabs.query(q)
      if (active[0]) pushTab(active[0])
    } catch {
      /* continue */
    }
  }

  // 2) 所有已打开的职位列表
  try {
    const tabs = await chrome.tabs.query({
      url: ['*://*.zhipin.com/*', '*://*.bosszhipin.com/*'],
    })
    for (const t of tabs) pushTab(t)
  } catch {
    /* ignore */
  }

  if (candidates.length) {
    // 优先：非推荐 URL（expect 等）；否则第一个
    const nonRec = candidates.find((c) => c.listLabel && !isRecommendish(c.listLabel))
    const pick = nonRec || candidates[0]
    // 只对选中 tab 精读一次顶栏分类（失败则保留 URL 推断）
    try {
      const refined = await guessListLabel(pick.tabId, pick.listUrl)
      if (refined) pick.listLabel = refined
    } catch {
      /* keep url label */
    }
    return { ok: true, ...pick }
  }

  // 3) 兜底创建推荐页
  const tab = await chrome.tabs.create({ url: BOSS_URLS.recommend, active: false })
  if (tab.id == null) return { ok: false, error: '无法创建工作标签' }
  await waitTabComplete(tab.id)
  return {
    ok: true,
    tabId: tab.id,
    listUrl: normalizePageUrl(BOSS_URLS.recommend),
    listLabel: '推荐职位',
  }
}

export async function guessListLabel(tabId: number, listUrl: string): Promise<string> {
  // 优先读页面上当前高亮的分类标签（项目经理/主管…）
  try {
    // content 可能刚注入
    await waitContentReady(tabId, 3_000)
    const det = await sendToTabOnce(tabId, { op: 'detect_page' })
    if (det.ok) {
      const data = det.data as {
        listTab?: string | null
        listTabs?: Array<{ label: string; selected?: boolean }>
      }
      if (data?.listTab && data.listTab.length >= 2) return data.listTab
      // 回退：listTabs 里 selected 的非空项
      const selected = (data?.listTabs || []).find((t) => t.selected && t.label)
      if (selected?.label) return selected.label
      // 再回退：若 tabs 里只有一个非推荐，用它（用户几乎肯定在该期望上）
      const nonRec = (data?.listTabs || []).filter(
        (t) => t.label && !isRecommendish(t.label),
      )
      if (nonRec.length === 1) return nonRec[0].label
    }
  } catch {
    /* ignore */
  }

  const src = detectSourceFromUrl(listUrl)
  if (src === 'recommend') return '推荐职位'
  // /jobs 默认不要写成「推荐职位」，否则 restore 会当成推荐跳过
  if (src === 'expect2') return '求职期望2'
  if (src === 'expect1') return '求职期望1'
  return '当前职位列表'
}

/**
 * 取本轮锁定的列表 URL：cursor.listUrl 优先，否则当前 worker 若在列表页则锁它。
 */
export async function resolveListUrl(workerTabId: number): Promise<string> {
  const state = await kv.getRunState()
  if (state.status === 'running' && state.cursor.listUrl) {
    return state.cursor.listUrl
  }
  try {
    const t = await chrome.tabs.get(workerTabId)
    if (isJobListUrl(t.url)) return normalizePageUrl(t.url!)
  } catch {
    /* ignore */
  }
  return normalizePageUrl(BOSS_URLS.recommend)
}

export async function resolveListLabel(): Promise<string | undefined> {
  const state = await kv.getRunState()
  if (state.status === 'running') return state.cursor.listLabel
  return undefined
}

/**
 * 确保 worker 在「锁定的列表 URL + 锁定分类标签」。
 * 关键：已在职位列表路径时，禁止 reload/无意义 navigate（会把 SPA 重置成「推荐」）。
 */
export async function ensureOnListPage(
  tabId: number,
  listUrl: string,
  gen?: number,
  listLabel?: string,
): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId)
    const cur = tab.url || ''
    const label = listLabel ?? (await resolveListLabel())

    // 聊天 / 简历 / 详情 → 回列表 URL
    if (isChatUrl(cur) || isResumeUrl(cur) || isJobDetailUrl(cur) || !isJobListUrl(cur)) {
      const ok = await navigateWorker(tabId, listUrl, gen)
      if (!ok) return false
    } else if (!isSamePageUrl(cur, listUrl) && !bothAreJobListPages(cur, listUrl)) {
      // 列表路径本质相同（/job vs /jobs）时不要硬跳，以免重置分类
      const ok = await navigateWorker(tabId, listUrl, gen)
      if (!ok) return false
    } else {
      // 已在列表：只保活 content，绝不 reload
      if (!(await waitContentReady(tabId, 2_500, gen))) {
        // 同 URL revive 可能 reload —— 尽量只 ping 重试
        for (let i = 0; i < 5 && !(await waitContentReady(tabId, 1_000, gen)); i++) {
          await sleep(400)
        }
        if (!(await waitContentReady(tabId, 2_000, gen))) {
          const revived = await reviveWorkerTab(tabId, { url: listUrl, gen })
          if (!revived) return false
        }
      }
    }

    // SPA 分类：必须点回锁定标签（非推荐时）
    if (label && label !== '当前职位列表') {
      const restored = await restoreListCategory(tabId, label, gen)
      if (!restored && !isRecommendish(label)) {
        // 分类未恢复成功：仍返回 true 让上层 list，但上层会再校验
        await appendEvent({
          type: 'error',
          payload: {
            op: 'ensureOnListPage_category',
            error: '分类标签可能未恢复',
            label,
          },
        }).catch(() => undefined)
      }
    }
    return true
  } catch {
    // 异常路径才 navigate
    const ok = await navigateWorker(tabId, listUrl, gen)
    if (!ok) return false
    const label = listLabel ?? (await resolveListLabel())
    if (label && label !== '当前职位列表') {
      await restoreListCategory(tabId, label, gen)
    }
    return true
  }
}

/** /web/geek/job 与 /web/geek/jobs 视为同类列表页，避免互跳重置分类 */
function bothAreJobListPages(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  if (!isJobListUrl(a) || !isJobListUrl(b)) return false
  try {
    const pa = new URL(a).pathname.replace(/\/+$/, '')
    const pb = new URL(b).pathname.replace(/\/+$/, '')
    const norm = (p: string) => p.replace(/\/jobs?$/i, '/job')
    return (
      norm(pa) === norm(pb) ||
      (pa.includes('job') &&
        pb.includes('job') &&
        !pa.includes('recommend') &&
        !pb.includes('recommend'))
    )
  } catch {
    return false
  }
}

/** 点击顶部分类标签恢复期望；返回是否最终落在目标分类上 */
export async function restoreListCategory(
  tabId: number,
  label: string,
  gen?: number,
): Promise<boolean> {
  if (!label || label === '当前职位列表') return true
  // 推荐页 URL 本身即推荐，不必点
  try {
    const tab = await chrome.tabs.get(tabId)
    if (
      (label === '推荐职位' || label === '推荐') &&
      /job-recommend/i.test(tab.url || '')
    ) {
      return true
    }
  } catch {
    /* ignore */
  }

  const readLabel = async (): Promise<string> => {
    try {
      const det = await sendToTabOnce(tabId, { op: 'detect_page' })
      if (!det.ok) return ''
      return (det.data as { listTab?: string | null })?.listTab || ''
    } catch {
      return ''
    }
  }

  // 已在目标分类：不点
  let cur = await readLabel()
  if (cur && labelsLikelySame(label, cur)) return true

  // 最多 3 次点击恢复（SPA 偶发丢点击）
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (gen != null && !(await isStillRunning(gen))) return false
    const r = await execOnWorker({ op: 'select_list_tab', label }, tabId, { gen })
    if (!r.ok) {
      await appendEvent({
        type: 'error',
        payload: {
          op: 'select_list_tab',
          error: r.error,
          label,
          attempt,
        },
      }).catch(() => undefined)
      await sleep(800)
      continue
    }
    const data = r.data as { alreadyActive?: boolean; matched?: string } | undefined
    if (data?.alreadyActive) return true
    await sleep(attempt === 1 ? 2000 : 1500)
    cur = await readLabel()
    if (cur && labelsLikelySame(label, cur)) return true
    await appendEvent({
      type: 'error',
      payload: {
        op: 'select_list_tab_verify',
        label,
        got: cur || '(空)',
        matched: data?.matched,
        attempt,
      },
    }).catch(() => undefined)
  }
  return false
}

export function isRecommendish(s: string): boolean {
  const t = (s || '').replace(/\s+/g, '')
  return t === '推荐' || t === '推荐职位' || t.startsWith('推荐')
}

/** 项目经理/主管 vs 项目经理/主… */
export function labelsLikelySame(a: string, b: string): boolean {
  const na = (a || '').replace(/\s+/g, '').replace(/[…·.．/／|｜\-_—–]/g, '')
  const nb = (b || '').replace(/\s+/g, '').replace(/[…·.．/／|｜\-_—–]/g, '')
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length >= 4 && nb.length >= 4 && (na.startsWith(nb) || nb.startsWith(na))) {
    return true
  }
  return false
}

/** list 前校验分类；不对则再 restore 一次 */
export async function verifyListCategoryOrRestore(
  tabId: number,
  label: string,
  gen?: number,
): Promise<{ ok: boolean; error?: string; got?: string }> {
  const read = async () => {
    try {
      const det = await sendToTabOnce(tabId, { op: 'detect_page' })
      if (!det.ok) return ''
      return (det.data as { listTab?: string | null })?.listTab || ''
    } catch {
      return ''
    }
  }
  let got = await read()
  if (got && labelsLikelySame(label, got)) return { ok: true, got }
  // 当前是推荐或读不到 → 强制 restore
  await restoreListCategory(tabId, label, gen)
  got = await read()
  if (got && labelsLikelySame(label, got)) return { ok: true, got }
  // 读不到 listTab 但 restore 返回成功时：若 got 为空且不是明显推荐，放行一次（DOM 选择器未标定）
  if (!got) {
    return {
      ok: false,
      error: `无法读取顶栏分类（期望「${label}」）。请保持在项目经理等期望页再开始。`,
      got: '(空)',
    }
  }
  if (isRecommendish(got) && !isRecommendish(label)) {
    return {
      ok: false,
      error: `仍停在「${got}」，未能回到「${label}」`,
      got,
    }
  }
  // 读到其它非推荐标签：若与目标不像，也挡
  if (!labelsLikelySame(label, got)) {
    return {
      ok: false,
      error: `顶栏是「${got}」，与锁定「${label}」不一致`,
      got,
    }
  }
  return { ok: true, got }
}

export function waitTabComplete(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }, timeoutMs)
    function listener(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    chrome.tabs
      .get(tabId)
      .then((t) => {
        if (t.status === 'complete') {
          clearTimeout(timer)
          chrome.tabs.onUpdated.removeListener(listener)
          resolve()
        }
      })
      .catch(reject)
  })
}

/** 单次 sendMessage，不做恢复（恢复层在外） */
export async function sendToTabOnce(
  tabId: number,
  command: ContentCommand,
): Promise<ContentResult> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      channel: 'content/exec',
      command,
    })
    return (res?.result ?? res) as ContentResult
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? `${e.message}（请确认已打开并刷新 BOSS 页面以注入 content script）`
          : 'content script 无响应',
    }
  }
}

/** 轮询 ping，直到 content script 可收消息或超时 */
export async function waitContentReady(
  tabId: number,
  timeoutMs = 12_000,
  gen?: number,
): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (gen != null && !(await isStillRunning(gen))) return false
    const ping = await sendToTabOnce(tabId, { op: 'ping' })
    if (ping.ok) return true
    await sleep(350)
  }
  return false
}

/**
 * 导航后 / 桥接失联后恢复 worker：
 * 1) 先等 content 就绪
 * 2) 失败则 tabs.update 到目标 URL（踢出 bfcache）— 仅当当前 URL 与目标不同
 * 3) 同 URL 才 reload
 */
export async function reviveWorkerTab(
  tabId: number,
  opts?: { url?: string; gen?: number },
): Promise<boolean> {
  if (await waitContentReady(tabId, 2_500, opts?.gen)) return true

  const targetUrl = opts?.url
  try {
    const tab = await chrome.tabs.get(tabId)
    const cur = tab.url || ''
    if (targetUrl && !isSamePageUrl(cur, targetUrl)) {
      await chrome.tabs.update(tabId, { url: targetUrl })
    } else {
      // 同页：只 reload 一次，避免 navigate 循环
      await chrome.tabs.reload(tabId)
    }
  } catch {
    try {
      await chrome.tabs.reload(tabId)
    } catch {
      return false
    }
  }
  await waitTabComplete(tabId, 20_000)
  await sleep(800)
  return waitContentReady(tabId, 10_000, opts?.gen)
}

/**
 * SW 主导航：
 * - 同页：绝不 tabs.update / reload
 * - 仅 URL 真不同时才 update
 * - 禁止「都是列表页就留在当前」——会从锁定分类掉到推荐
 */
export async function navigateWorker(
  tabId: number,
  url: string,
  gen?: number,
): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId)
    const cur = tab.url || ''
    if (isSamePageUrl(cur, url)) {
      if (await waitContentReady(tabId, 3_000, gen)) return true
      return reviveWorkerTab(tabId, { url: cur, gen })
    }
    await chrome.tabs.update(tabId, { url })
    await waitTabComplete(tabId, 20_000)
    await sleep(1000)
    if (await waitContentReady(tabId, 10_000, gen)) return true
    return reviveWorkerTab(tabId, { url, gen })
  } catch {
    return reviveWorkerTab(tabId, { url, gen })
  }
}

export async function execOnWorker(
  command: ContentCommand,
  tabId?: number,
  opts?: { gen?: number; recoverUrl?: string },
): Promise<ContentResult> {
  const id = tabId ?? (await ensureWorkerTab())
  let result = await sendToTabOnce(id, command)

  // 导航/跳转类命令成功且标记 navigating：必须等新文档 content 就绪
  if (result.ok && (result.data as { navigating?: boolean } | undefined)?.navigating) {
    await waitTabComplete(id, 15_000)
    await sleep(600)
    const ready = await waitContentReady(id, 10_000, opts?.gen)
    if (!ready) {
      await reviveWorkerTab(id, { url: opts?.recoverUrl, gen: opts?.gen })
    }
    return result
  }

  // 桥接失联：恢复后重试 1 次（禁止直接熔断整轮）
  if (!result.ok && isContentBridgeDead(result.error)) {
    const revived = await reviveWorkerTab(id, {
      url: opts?.recoverUrl,
      gen: opts?.gen,
    })
    if (revived) {
      result = await sendToTabOnce(id, command)
    }
  }
  return result
}

/**
 * 消息页优先：复用用户已打开的聊天标签（不关）。
 * 仅当没有聊天页时才临时创建，用完关闭。
 * allowCreate=false：无现有消息页则失败（「处理当前会话」用）。
 */
export async function withChatTab<T>(
  gen: number | null,
  fn: (chatTabId: number) => Promise<T>,
  opts?: { preferExisting?: boolean; allowCreate?: boolean },
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const preferExisting = opts?.preferExisting !== false
  const allowCreate = opts?.allowCreate !== false
  let createdId: number | undefined
  let tabId: number | undefined

  try {
    if (preferExisting) {
      const tabs = await chrome.tabs.query({
        url: ['*://*.zhipin.com/*', '*://*.bosszhipin.com/*'],
      })
      // 优先：当前激活的聊天页
      const active = await chrome.tabs.query({ active: true, currentWindow: true })
      const a = active[0]
      if (a?.id != null && isChatUrl(a.url)) {
        tabId = a.id
      } else {
        const chatTab = tabs.find((t) => t.id != null && isChatUrl(t.url))
        if (chatTab?.id != null) tabId = chatTab.id
      }
    }

    if (tabId == null) {
      if (!allowCreate) {
        return {
          ok: false,
          error: '未找到已打开的消息页。请先打开 BOSS 消息页并点开右侧会话。',
        }
      }
      const tab = await chrome.tabs.create({ url: BOSS_URLS.chat, active: false })
      createdId = tab.id
      tabId = tab.id
      if (tabId == null) return { ok: false, error: '无法创建聊天标签' }
      await waitTabComplete(tabId, 20_000)
      await sleep(1200)
    }

    if (gen != null && !(await isStillRunning(gen))) {
      return { ok: false, error: '已停止' }
    }
    if (!(await waitContentReady(tabId, 12_000, gen ?? undefined))) {
      return { ok: false, error: '聊天页 content script 未就绪' }
    }
    const value = await fn(tabId)
    return { ok: true, value }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    // 只关我们新建的临时标签
    if (createdId != null) {
      try {
        await chrome.tabs.remove(createdId)
      } catch {
        /* ignore */
      }
    }
  }
}

/** @deprecated 语义保留：内部改走 withChatTab */
export async function withEphemeralChatTab<T>(
  gen: number,
  fn: (chatTabId: number) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  return withChatTab(gen, fn, { preferExisting: true })
}
