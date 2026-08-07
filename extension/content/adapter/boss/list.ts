import type { JobSource } from '../../../shared/types'
import { urlForSource as urlForSourceShared } from '../../../shared/boss-urls'
import {
  SELECTORS,
  firstEl,
  allEl,
  textOf,
  safeClick,
  firstByOrderedSelectors,
  JOB_TITLE_SELECTORS,
} from './selectors'
import { readSalary, type DecodeOptions } from './obfuscated-text'
import { calibratePuaDigits, collectPuaCodepoints } from './font-calibration'

/**
 * 为本页薪资建立解码选项。
 *
 * 优先字形标定（抗字体映射轮换）；标定不可靠时回退静态基准，
 * 两条路径的结果都仍需通过 readSalary 的形状/数值校验。
 */
function buildSalaryDecoder(): DecodeOptions {
  const els = allEl(document, SELECTORS.salary)
  if (!els.length) return {}
  const cps = collectPuaCodepoints(els.map((e) => textOf(e)).join(''))
  if (!cps.length) return {}
  let font = ''
  try {
    font = getComputedStyle(els[0]).fontFamily
  } catch {
    /* ignore */
  }
  const map = calibratePuaDigits(font, cps)
  return map ? { map } : {}
}

export type CardJob = {
  id: string
  title: string
  company: string
  salary?: string
  city?: string
  source: JobSource
  /** 仅 DOM 上真实 job_detail 链接；绝不拼假 URL */
  href?: string
}

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return String(h >>> 0)
}

/** 薪资文案：10-15K / 15K-25K / 面议 等 */
export function looksLikeSalary(text?: string): boolean {
  if (!text) return false
  const t = text.replace(/\s+/g, '')
  if (/面议|薪资面议/.test(t)) return true
  return (
    /\d+(\.\d+)?\s*[-~～—–]\s*\d+(\.\d+)?\s*[Kk千万元]?/.test(t) ||
    /\d+(\.\d+)?\s*[Kk]/.test(t) ||
    /\d+\s*元/.test(t)
  )
}

/** 明显是公司名而非岗位名 */
export function looksLikeCompanyName(title: string): boolean {
  const t = title.replace(/\s+/g, '').trim()
  if (!t) return false
  // 含岗位词则不当公司
  if (
    /经理|主管|总监|工程师|顾问|专员|助理|架构|产品|运营|销售|开发|实施|项目|总监|专家|负责人|管培|实习/.test(
      t,
    )
  ) {
    return false
  }
  return (
    /有限公司|股份有限|集团|科技有限|实业|网络科技|信息技术|控股|分公司|工作室|工作室|有限责任/.test(
      t,
    ) ||
    /公司$/.test(t) ||
    // 纯品牌短名且无岗位词：如「达梦数据库」单独出现时，若无薪资应在上层拒
    false
  )
}

/**
 * 是否可当作一条职位卡（纯函数，可单测）
 * 核心：禁止把「公司行」扫成职位
 */
export function isPlausibleJobCard(input: {
  title: string
  company?: string
  salary?: string
  href?: string
  hasJobTitleEl?: boolean
}): boolean {
  const title = (input.title || '').replace(/\s+/g, ' ').trim()
  if (title.length < 2 || title.length > 80) return false
  if (/登录|注册|隐私|协议|筛选|清除|推荐职位|查看更多|加载中/.test(title)) return false

  const company = (input.company || '').replace(/\s+/g, ' ').trim()

  // 标题与公司完全相同 → 一定是公司行误扫
  if (company && title === company) return false

  // 标题就是公司形态（有限公司/实业…）且无薪资
  if (looksLikeCompanyName(title) && !looksLikeSalary(input.salary)) return false

  // 标题≈公司且无岗位词、无薪资
  if (
    company &&
    (company.includes(title) || title.includes(company)) &&
    !looksLikeSalary(input.salary) &&
    !/经理|主管|工程师|顾问|专员|项目|总监|销售|开发|实施/.test(title)
  ) {
    return false
  }

  // 必须有：薪资 或 真实详情链接（仅有 job-name 节点不够——公司块也可能有）
  const hasSignal =
    looksLikeSalary(input.salary) || Boolean(input.href && /job_detail\//i.test(input.href))
  if (!hasSignal) return false

  // 无薪资且标题像地点
  if (!looksLikeSalary(input.salary) && /区$|市$|路$|街$/.test(title)) return false

  return true
}

/** 卡片上的真实详情链接（有则可用；无则只点卡片开抽屉） */
export function extractCardHref(card: Element): string | undefined {
  const anchors = Array.from(card.querySelectorAll('a[href]')) as HTMLAnchorElement[]
  for (const a of anchors) {
    const href = a.href || a.getAttribute('href') || ''
    if (/job_detail\//i.test(href) && !/javascript:/i.test(href)) {
      try {
        return new URL(href, location.origin).href
      } catch {
        return href
      }
    }
  }
  return undefined
}

/**
 * 职位 id：优先 data-jobid / job_detail 路径里的 encryptId。
 * 禁止从任意链接乱抠 hex（会拼出 404 假详情页）。
 */
export function extractId(card: Element): string {
  const dataId =
    card.getAttribute('data-jobid') ||
    card.getAttribute('data-jid') ||
    card.querySelector('[data-jobid]')?.getAttribute('data-jobid') ||
    card.querySelector('[data-jid]')?.getAttribute('data-jid')
  if (dataId && dataId.trim().length >= 6) return dataId.trim()

  const href = extractCardHref(card)
  if (href) {
    const m = href.match(/job_detail\/([^?.#]+)/i)
    if (m) return m[1].replace(/\.html$/i, '')
  }

  const kaBlob = card.getAttribute('ka') || card.outerHTML.slice(0, 500)
  const km = kaBlob.match(/[?&]jobId=([a-zA-Z0-9_-]{8,})/i)
  if (km) return km[1]

  const title = textOf(firstEl(card, SELECTORS.jobTitle))
  const company = textOf(firstEl(card, SELECTORS.companyName))
  return `hash:${simpleHash(title + '|' + company)}`
}

/** 去掉嵌套：子节点若也在 jobCard 集合里，只保留最外层整卡 */
function dedupeOuterCards(nodes: Element[]): Element[] {
  const set = new Set(nodes)
  return nodes.filter((el) => {
    let p = el.parentElement
    while (p) {
      if (set.has(p)) return false
      p = p.parentElement
    }
    return true
  })
}

export function listJobsFromDom(source: JobSource): CardJob[] {
  const raw = Array.from(document.querySelectorAll(SELECTORS.jobCard))
  const cards = dedupeOuterCards(raw)
  const out: CardJob[] = []
  const seen = new Set<string>()
  const salaryDecoder = buildSalaryDecoder()

  for (const card of cards) {
    // 关键：标题只从职位名节点取，禁止 card.querySelector('a')（公司 a 会被当成 title）
    // 必须按优先级取：逗号列表会按 DOM 序命中外层 div.job-title（含薪资）
    const titleEl = firstByOrderedSelectors(card, JOB_TITLE_SELECTORS)
    const title = textOf(titleEl)
    if (!title) continue

    const company = textOf(firstEl(card, SELECTORS.companyName)) || ''
    // 薪资数字被 kanzhun-mix 字体映射到私有区码位，textContent 只能读到 "-K"。
    // 先解码再校验；解不出就当缺失，绝不把可疑数字喂给匹配决策。
    const salaryRaw = textOf(firstEl(card, SELECTORS.salary)) || undefined
    const salary =
      readSalary(salaryRaw, salaryDecoder) ??
      (looksLikeSalary(salaryRaw) ? salaryRaw : undefined)
    const href = extractCardHref(card)

    if (
      !isPlausibleJobCard({
        title,
        company,
        salary,
        href,
        hasJobTitleEl: Boolean(titleEl),
      })
    ) {
      continue
    }

    const id = extractId(card)
    if (seen.has(id)) continue
    seen.add(id)

    // 指纹去重：同一 title+company 只留一条（防止子节点漏网）
    const fp = `${title}|${company}`.toLowerCase()
    if (seen.has(`fp:${fp}`)) continue
    seen.add(`fp:${fp}`)

    out.push({
      id,
      title: title.slice(0, 120),
      company: company || '未知公司',
      salary,
      city: textOf(firstEl(card, SELECTORS.city)) || undefined,
      source,
      href,
    })
  }
  return out
}

export function findCardElement(jobId: string): Element | null {
  const cards = dedupeOuterCards(Array.from(document.querySelectorAll(SELECTORS.jobCard)))
  for (const card of cards) {
    const id = extractId(card)
    if (id === jobId) return card
    if (jobId && !jobId.startsWith('hash:') && card.outerHTML.includes(jobId)) return card
  }
  return null
}

export function clickJobCard(jobId: string): boolean {
  const card = findCardElement(jobId)
  if (!card) return false
  // 列表卡是唯一需要「点整卡」的场景：避开卡内 a[href=javascript:] / a[target=_blank]
  return safeClick(card as HTMLElement, { resolveCard: true })
}

/**
 * 打开职位：
 * 1) 优先点击列表卡片（推荐/期望页右侧抽屉）
 * 2) 仅当卡片带真实 job_detail 链接且点击失败时，才在本标签打开
 * 3) 绝不伪造 /job_detail/{id}.html
 */
export function openJob(
  jobId: string,
  href?: string,
): { ok: boolean; navigating?: boolean; error?: string } {
  if (
    href &&
    /job_detail\//i.test(href) &&
    location.href.includes(jobId) &&
    /job_detail\//i.test(location.href)
  ) {
    return { ok: true, navigating: false }
  }

  if (clickJobCard(jobId)) {
    return { ok: true, navigating: false }
  }

  const realHref =
    href && /job_detail\//i.test(href) && !jobId.startsWith('hash:') ? href : undefined
  if (realHref) {
    location.assign(realHref)
    return { ok: true, navigating: true }
  }

  return {
    ok: false,
    error: `未找到职位卡片 ${jobId}（请回到推荐/职位列表页；不会再跳转伪造详情 URL）`,
  }
}

export function urlForSource(source: JobSource): string {
  return urlForSourceShared(source)
}

export function detectSourceFromUrl(): JobSource | null {
  const u = location.href
  if (u.includes('job-recommend')) return 'recommend'
  if (u.includes('expectIndex=1') || u.includes('expect=1')) return 'expect2'
  try {
    const path = new URL(u).pathname.replace(/\/+$/, '') || '/'
    if (path === '/web/geek/job' || path === '/web/geek/jobs') return 'current'
    if (path.includes('job-recommend')) return 'recommend'
  } catch {
    /* ignore */
  }
  if (/\/web\/geek\/jobs?(\?|$)/i.test(u)) return 'current'
  return 'current'
}

/** 规范化标签文案便于模糊匹配 */
export function normTabLabel(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/[…·.．/／|｜\-_—–]/g, '')
    .toLowerCase()
}

function isRecommendLabel(s: string): boolean {
  const n = normTabLabel(s)
  return n === '推荐' || n === '推荐职位' || n === '精选' || n.startsWith('推荐')
}

/**
 * 标签匹配分（越高越好）。禁止用过松的 includes 误点「推荐」。
 * 用于：项目经理/主管 vs 截断「项目经理/主…」vs 销售经理
 */
export function scoreListTabMatch(target: string, candidate: string): number {
  const t = normTabLabel(target)
  const c = normTabLabel(candidate)
  if (!t || !c) return 0
  if (t === c) return 100
  // 截断展示：项目经理主 ⊂ 项目经理主管
  if (t.startsWith(c) && c.length >= 4) return 80 + Math.min(c.length, 15)
  if (c.startsWith(t) && t.length >= 4) return 80 + Math.min(t.length, 15)
  if (t.includes(c) && c.length >= 4) return 60 + Math.min(c.length, 10)
  if (c.includes(t) && t.length >= 4) return 60 + Math.min(t.length, 10)
  // 共同前缀（至少 4 字，避免「经理」互撞）
  let pre = 0
  while (pre < t.length && pre < c.length && t[pre] === c[pre]) pre++
  if (pre >= 4) return 40 + pre
  return 0
}

const TAB_MATCH_THRESHOLD = 60

/**
 * 点击顶部职位分类/期望标签（推荐、项目经理/主管…）
 * BOSS 是 SPA：只回到 /jobs URL 会掉回默认「推荐」
 */
export function selectListTabByLabel(label: string): {
  ok: boolean
  matched?: string
  score?: number
  error?: string
  alreadyActive?: boolean
} {
  const want = (label || '').trim()
  if (!want || want === '当前职位列表') {
    return { ok: true, matched: want || 'skip' }
  }

  const target = want === '推荐职位' ? '推荐' : want
  const targetIsRecommend = isRecommendLabel(target)

  // 已在目标分类：不点击，避免 SPA 抖动掉回推荐
  const active = readActiveListTabLabel()
  if (active && scoreListTabMatch(target, active) >= TAB_MATCH_THRESHOLD) {
    return { ok: true, matched: active, score: scoreListTabMatch(target, active), alreadyActive: true }
  }

  // 顶部 expect / 分类条：优先窄容器，避免扫到页脚
  const rootSelectors = [
    '.expect-list',
    '.job-tab',
    '.tab-list',
    '[class*="expect-list"]',
    '[class*="ExpectList"]',
    '[class*="job-tab"]',
    'ul[class*="expect"]',
    '[role="tablist"]',
  ]
  let roots: Element[] = []
  for (const sel of rootSelectors) {
    try {
      roots.push(...Array.from(document.querySelectorAll(sel)))
    } catch {
      /* ignore */
    }
  }
  if (!roots.length) roots = [document.body]

  type Cand = { el: HTMLElement; text: string; score: number }
  const scored: Cand[] = []
  const seen = new Set<HTMLElement>()

  for (const root of roots) {
    const nodes = Array.from(
      root.querySelectorAll('a, span, div, li, button, [role="tab"]'),
    ) as HTMLElement[]
    for (const el of nodes) {
      if (seen.has(el)) continue
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
      if (!t || t.length > 28) continue
      if (/筛选|清除|搜索|地图|登录|注册|消息|简历|沟通|加号|\+|更多|设置/.test(t)) {
        continue
      }
      // 目标不是推荐时，禁止点「推荐」
      if (!targetIsRecommend && isRecommendLabel(t)) continue

      const sc = scoreListTabMatch(target, t)
      if (sc < TAB_MATCH_THRESHOLD) continue
      seen.add(el)
      scored.push({ el, text: t, score: sc })
    }
  }

  scored.sort((a, b) => b.score - a.score || a.text.length - b.text.length)
  if (!scored.length) {
    return {
      ok: false,
      error: `未找到分类标签「${target}」（当前高亮=${active || '无'}；页面可能未加载完）`,
    }
  }

  const best = scored[0]
  const clickable =
    (best.el.closest(
      'a, li, button, [role="tab"], .expect-item, [class*="expect-item"], [class*="tab-item"]',
    ) as HTMLElement) || best.el
  if (!safeClick(clickable)) {
    return { ok: false, error: `找到标签「${best.text}」但点击失败` }
  }
  return { ok: true, matched: best.text.slice(0, 40), score: best.score }
}

function isTopTabBarEl(el: Element): boolean {
  try {
    const r = (el as HTMLElement).getBoundingClientRect?.()
    // 顶部分类条通常在首屏上半，且有一定宽度
    if (!r || r.top > 220 || r.bottom < 0) return false
    if (r.width < 20 || r.height < 12 || r.height > 80) return false
    return true
  } catch {
    return false
  }
}

function looksLikeCategoryTabText(t: string): boolean {
  const s = (t || '').replace(/\s+/g, ' ').trim()
  if (!s || s.length < 2 || s.length > 24) return false
  if (/筛选|清除|搜索|地图|登录|注册|消息|简历|沟通|加号|更多|设置|城市|薪资|经验|学历|公司/.test(s)) {
    return false
  }
  return true
}

/** 是否像「选中」态 */
function elLooksSelected(el: HTMLElement): boolean {
  const cls = `${el.className || ''} ${el.parentElement?.className || ''}`
  if (/active|selected|current|is-active|on\b/i.test(cls)) return true
  if (el.getAttribute('aria-selected') === 'true') return true
  // BOSS 常给选中项加粗/变色：用 data 或 style 弱信号不够稳，主要靠 class
  return false
}

/**
 * 枚举顶部分类标签（推荐 / 项目经理…）
 * 用于启动锁定与恢复校验
 */
export function listCategoryTabs(): Array<{ label: string; selected: boolean }> {
  const rootSelectors = [
    '.expect-list',
    '.job-tab',
    '.tab-list',
    '[class*="expect-list"]',
    '[class*="ExpectList"]',
    '[class*="job-tab"]',
    'ul[class*="expect"]',
    '[role="tablist"]',
    // 截图结构：顶栏横排文字标签
    '.job-home-left',
    '.page-job .job-recommend-search',
  ]
  const roots: Element[] = []
  for (const sel of rootSelectors) {
    try {
      roots.push(...Array.from(document.querySelectorAll(sel)))
    } catch {
      /* ignore */
    }
  }
  // 回退：整页顶部区域的短标签
  if (!roots.length) roots.push(document.body)

  const out: Array<{ label: string; selected: boolean }> = []
  const seen = new Set<string>()

  for (const root of roots) {
    const nodes = Array.from(
      root.querySelectorAll('a, span, div, li, button, [role="tab"]'),
    ) as HTMLElement[]
    for (const el of nodes) {
      if (!isTopTabBarEl(el)) continue
      // 只要叶子文本，避免父容器吞掉整行「推荐 销售 项目」
      const childTabs = el.querySelectorAll('a, span, li, button, [role="tab"]')
      if (childTabs.length > 2 && el !== document.body) continue

      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
      if (!looksLikeCategoryTabText(t)) continue
      // 整行多段用 | 切开时 innerText 可能是单标签
      if (t.includes(' ') && t.length > 12) continue

      const key = normTabLabel(t)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ label: t.slice(0, 40), selected: elLooksSelected(el) })
    }
  }

  // 若一个 selected 都没有，但存在「推荐」+其它，不要猜
  return out
}

/** 读取当前高亮的分类标签文案（启动锁定用） */
export function readActiveListTabLabel(): string | undefined {
  const activeSelectors = [
    '.expect-list .active',
    '.expect-list .selected',
    '.expect-list [class*="active"]',
    '.expect-item.active',
    '.expect-item.selected',
    '[class*="expect"] .active',
    '[class*="expect"] .selected',
    '[class*="expect-item"][class*="active"]',
    '.job-tab .active',
    '[role="tab"][aria-selected="true"]',
    'li.selected',
    'a.selected',
    '[class*="tab"][class*="active"]',
  ]
  for (const sel of activeSelectors) {
    try {
      const nodes = Array.from(document.querySelectorAll(sel))
      for (const el of nodes) {
        if (!isTopTabBarEl(el)) continue
        const t = textOf(el).replace(/\s+/g, ' ').trim()
        if (looksLikeCategoryTabText(t)) return t
      }
    } catch {
      /* ignore */
    }
  }

  // 回退：枚举分类条，取 selected
  const tabs = listCategoryTabs()
  const selected = tabs.find((t) => t.selected)
  if (selected) return selected.label

  // 再回退：若只有一个非推荐标签像「当前」，仍不要猜推荐
  const nonRec = tabs.filter((t) => !isRecommendLabel(t.label))
  if (nonRec.length === 1 && tabs.length <= 4) return nonRec[0].label

  return undefined
}