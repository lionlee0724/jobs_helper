/**
 * 实页选择器标定探针（诊断专用，不参与自动流程）
 *
 * 存在理由：仓库内 .tmp-*.html 快照全部是反爬拦截页，selectors.ts 从未在真实
 * DOM 上验证过。本模块把「选择器是否命中、命中了什么」变成可观测证据，
 * 用于证伪假设，而不是继续盲猜选择器。
 *
 * 同时内置针对已知缺陷假设的定向检查：
 * - H-A: safeClick 把点击重定向到 job-card 祖先，导致开聊变成重开详情
 * - H-C: sendResumeBtn 含裸 .toolbar-btn，命中工具栏任意按钮
 * - H-D: 聊天输入为 contenteditable，textContent 注入不被框架感知
 */

import { SELECTORS, allEl, textOf, CARD_ROOT_SELECTOR } from './selectors'
import { readObfuscatedText, readSalary } from './obfuscated-text'
import { calibratePuaDigits, collectPuaCodepoints } from './font-calibration'

export type ElementSample = {
  tag: string
  cls: string
  id?: string
  ka?: string
  text: string
  visible: boolean
  rect: string
  path: string
}

export type SelectorProbe = {
  key: string
  count: number
  visibleCount: number
  samples: ElementSample[]
}

export type TextCandidate = ElementSample & {
  /** 建议用于 selectors.ts 的候选选择器 */
  suggest: string
  /** 该元素是否会被 safeClick 重定向到 job-card 祖先 */
  wouldRedirectToCard: boolean
  redirectTargetPath?: string
}

export type JobCardLinkProbe = {
  index: number
  title: string
  /** 卡片内是否存在真实 job_detail 链接—— 自动流程的硬前提 */
  hasDetailAnchor: boolean
  detailHref?: string
  anchorCount: number
  /** 卡片内所有 a[href] 的原始值（截断），用于判断是否全是 javascript:/# */
  anchorHrefs: string[]
  /** 卡片上的 data-* 属性，可能携带 jobId */
  dataAttrs: Record<string, string>
}

export type ProbeReport = {
  ts: number
  href: string
  title: string
  readyState: string
  pageKind: string
  /**
   * 职位卡链接情况。
   *
   * 背景：调度器走 processCardInEphemeralTab，必须拿到 job_detail 链接才能
   * 新开标签读 JD；拿不到就直接判「弱 JD」跳过，表现为「该投的没投」。
   */
  jobCards: JobCardLinkProbe[]
  /** 每组选择器的命中情况 */
  selectors: SelectorProbe[]
  /** 按可见文案反查的真实候选元素（标定依据） */
  textCandidates: Record<string, TextCandidate[]>
  /** 针对已知缺陷假设的定向检查 */
  hypotheses: {
    safeClickRedirect: {
      note: string
      affected: Array<{ text: string; path: string; redirectTo: string }>
    }
    chatInput: {
      note: string
      found: boolean
      kind: 'textarea' | 'input' | 'contenteditable' | 'none'
      frameworkHints: string[]
      path?: string
    }
    resumeBtnOverbroad: {
      note: string
      /** 裸 .toolbar-btn 命中的全部元素文案 */
      toolbarBtnTexts: string[]
    }
    /** 未读徐标标定：会话行与徐标命中情况 */
    unreadBadge: {
      note: string
      sessionRows: number
      rowsWithBadge: number
      samples: Array<{
        rowText: string
        badgeTag: string
        badgeCls: string
        badgeText: string
        rect: string
        visible: boolean
        countedAsUnread: boolean
      }>
    }
    /** 薪资数字为何读不到（textContent 仅得到 "-K"） */
    salaryRendering: {
      note: string
      /** 字形标定是否成功（失败则回退静态基准） */
      calibrated: boolean
      calibrationMap?: Record<string, string>
      fontFamily?: string
      samples: Array<{
        text: string
        /** 解码结果（标定优先） */
        decoded: string | null
        /** 仅静态基准的解码结果；与 decoded 不一致即证明映射已轮换 */
        staticDecoded: string | null
        /** 通过形状/数值校验后采用的值 */
        accepted: string | null
        /** 无法映射的码位：非空则说明字体映射已轮换 */
        unmapped: string[]
        /** 逐字符 Unicode 码位：私有区字符意味着自定义字体映射 */
        codepoints: string
        innerHTML: string
        fontFamily: string
        beforeContent: string
        afterContent: string
        childTags: string[]
      }>
    }
  }
}

const TEXT_GROUPS: Record<string, RegExp> = {
  openChat: /立即沟通|继续沟通|沟通一下|^\s*开聊\s*$|马上沟通/,
  sendResume: /发送简历|发简历|附件简历|投简历|发送附件/,
  chatSend: /^\s*发送\s*$/,
  resumeConfirm: /^\s*(确定|确认|发送|同意)\s*$/,
}

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false
  const st = getComputedStyle(el)
  if (st.display === 'none' || st.visibility === 'hidden') return false
  if (Number(st.opacity) === 0) return false
  return true
}

/**
 * 仅过滤哈希/随机类名。
 *
 * 早期版本用 /^[a-z]+-[a-z0-9]{5,}$/ 过滤，会误删 `job-primary` 这类
 * 关键结构类，导致证据里看不到真正命中卡片选择器的类。
 */
function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter(
    (c) =>
      c.length <= 40 &&
      !/\d{4,}/.test(c) &&
      !/^[a-f0-9]{8,}$/i.test(c) &&
      !/^(css|sc|jsx)-[a-z0-9]{5,}$/i.test(c),
  )
}

function shortPath(el: Element, maxDepth = 3): string {
  const parts: string[] = []
  let cur: Element | null = el
  let depth = 0
  while (cur && depth < maxDepth) {
    const tag = cur.tagName.toLowerCase()
    const cls = stableClasses(cur).slice(0, 3)
    parts.unshift(cls.length ? `${tag}.${cls.join('.')}` : tag)
    cur = cur.parentElement
    depth++
  }
  return parts.join(' > ')
}

function sampleOf(el: Element): ElementSample {
  const r = el instanceof HTMLElement ? el.getBoundingClientRect() : null
  return {
    tag: el.tagName.toLowerCase(),
    cls: stableClasses(el).join(' '),
    id: el.id || undefined,
    ka: el.getAttribute('ka') || undefined,
    text: textOf(el).slice(0, 60),
    visible: isVisible(el),
    rect: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '-',
    path: shortPath(el),
  }
}

/** 为元素生成一个建议选择器：优先 ka 属性，其次稳定 class */
function suggestSelector(el: Element): string {
  const ka = el.getAttribute('ka')
  if (ka) return `${el.tagName.toLowerCase()}[ka="${ka}"]`
  const cls = stableClasses(el)
  if (cls.length) return `${el.tagName.toLowerCase()}.${cls.slice(0, 2).join('.')}`
  if (el.id) return `#${el.id}`
  return shortPath(el, 2)
}

function detectPageKind(): string {
  const h = location.href
  if (/\/chat/i.test(h)) return 'chat'
  if (/job_detail/i.test(h)) return 'detail'
  if (/\/geek\/jobs?\b|recommend/i.test(h)) return 'list'
  if (/resume|geek\/new\/resume/i.test(h)) return 'profile'
  return 'other'
}

function probeGroup(key: string, selector: string): SelectorProbe {
  const els = allEl(document, selector)
  const samples = els.slice(0, 5).map(sampleOf)
  return {
    key,
    count: els.length,
    visibleCount: els.filter(isVisible).length,
    samples,
  }
}

function collectTextCandidates(): Record<string, TextCandidate[]> {
  const out: Record<string, TextCandidate[]> = {}
  const clickable = Array.from(
    document.querySelectorAll('a,button,[role="button"],span,div'),
  )
  for (const [group, re] of Object.entries(TEXT_GROUPS)) {
    const hits: TextCandidate[] = []
    for (const el of clickable) {
      const t = textOf(el)
      if (!t || t.length > 20) continue
      if (!re.test(t)) continue
      // 只保留最内层：若子元素也命中，跳过父元素
      if (Array.from(el.children).some((c) => re.test(textOf(c)))) continue
      const card = el.closest(CARD_ROOT_SELECTOR)
      hits.push({
        ...sampleOf(el),
        suggest: suggestSelector(el),
        wouldRedirectToCard: Boolean(card),
        redirectTargetPath: card ? shortPath(card) : undefined,
      })
      if (hits.length >= 8) break
    }
    out[group] = hits
  }
  return out
}

function frameworkHintsFor(el: Element): string[] {
  const hints: string[] = []
  const probeKeys = (o: object) =>
    Object.keys(o).filter((k) =>
      /^__(react|vue)|^_vnode|^__vueParentComponent|^__reactProps|^__reactFiber/.test(k),
    )
  let cur: Element | null = el
  let depth = 0
  while (cur && depth < 4) {
    for (const k of probeKeys(cur)) if (!hints.includes(k)) hints.push(k)
    cur = cur.parentElement
    depth++
  }
  return hints.slice(0, 6)
}

function probeUnreadBadge(): ProbeReport['hypotheses']['unreadBadge'] {
  const note =
    '对照页面上实际带红点/数字的会话数量校对 rowsWithBadge。' +
    '偏大说明选择器过宽（会把无新消息的会话排到前面），' +
    '偏小说明未命中，需根据 samples 里的真实类名补 selectors.chatSessionUnread。'

  const rows = allEl(document, SELECTORS.chatSessionItem)
  const samples: ProbeReport['hypotheses']['unreadBadge']['samples'] = []
  let rowsWithBadge = 0

  for (const row of rows.slice(0, 20)) {
    const badges = allEl(row, SELECTORS.chatSessionUnread)
    if (!badges.length) continue
    let rowCounted = false
    for (const b of badges.slice(0, 2)) {
      const t = textOf(b)
      const r = b instanceof HTMLElement ? b.getBoundingClientRect() : null
      const vis = isVisible(b)
      const counted =
        vis && (/^\d{1,3}$/.test(t) ? Number(t) > 0 : !t && !!r && r.width <= 16 && r.height <= 16)
      if (counted) rowCounted = true
      if (samples.length < 8) {
        samples.push({
          rowText: textOf(row).slice(0, 50),
          badgeTag: b.tagName.toLowerCase(),
          badgeCls: stableClasses(b).join(' '),
          badgeText: t.slice(0, 20),
          rect: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '-',
          visible: vis,
          countedAsUnread: counted,
        })
      }
    }
    if (rowCounted) rowsWithBadge++
  }

  return { note, sessionRows: rows.length, rowsWithBadge, samples }
}

function probeSalaryRendering(): ProbeReport['hypotheses']['salaryRendering'] {
  const note =
    '薪资 textContent 为 "-K" 而同卡片「10年以上」数字正常，说明薪资数字单独处理。' +
    'codepoints 出现 U+E0xx/U+F8xx 等私有区 → 自定义字体映射；' +
    'beforeContent/afterContent 有值 → CSS 伪元素渲染；' +
    'childTags 非空 → 数字拆在子节点里'

  const allSalary = allEl(document, SELECTORS.salary)
  const cps = collectPuaCodepoints(allSalary.map((e) => textOf(e)).join(''))
  let font = ''
  try {
    if (allSalary[0]) font = getComputedStyle(allSalary[0]).fontFamily
  } catch {
    /* ignore */
  }
  const calibrated = calibratePuaDigits(font, cps)
  const opts = calibrated ? { map: calibrated } : {}

  const els = allSalary.slice(0, 3)
  const samples = els.map((el) => {
    const text = textOf(el)
    let beforeContent = ''
    let afterContent = ''
    let fontFamily = ''
    try {
      const st = getComputedStyle(el)
      fontFamily = st.fontFamily
      beforeContent = getComputedStyle(el, '::before').content
      afterContent = getComputedStyle(el, '::after').content
    } catch {
      /* ignore */
    }
    const dec = readObfuscatedText(text, opts)
    return {
      text,
      decoded: dec.value,
      accepted: readSalary(text, opts),
      staticDecoded: readObfuscatedText(text).value,
      unmapped: dec.unmapped,
      codepoints: Array.from(text)
        .map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
        .join(' '),
      innerHTML: (el as HTMLElement).innerHTML.slice(0, 300),
      fontFamily,
      beforeContent,
      afterContent,
      childTags: Array.from(el.children).map(
        (c) => c.tagName.toLowerCase() + '.' + stableClasses(c).join('.'),
      ),
    }
  })
  return {
    note,
    calibrated: Boolean(calibrated),
    calibrationMap: calibrated
      ? Object.fromEntries(
          [...calibrated].map(([cp, d]) => [
            'U+' + cp.toString(16).toUpperCase().padStart(4, '0'),
            d,
          ]),
        )
      : undefined,
    fontFamily: font || undefined,
    samples,
  }
}

function probeChatInput(): ProbeReport['hypotheses']['chatInput'] {
  const note =
    'H-D：kind=none 或 found=false 说明 chatInput 选择器需重新标定；' +
    'kind=contenteditable 且有框架 hint 时，sendText 已改走 execCommand(insertText) 并校验输入框清空'
  const el = document.querySelector(SELECTORS.chatInput)
  if (!el) {
    // 回退：找页面上任意 contenteditable
    const ce = document.querySelector('[contenteditable="true"]')
    if (!ce) return { note, found: false, kind: 'none', frameworkHints: [] }
    return {
      note: note + '（chatInput 选择器未命中，但页面存在 contenteditable，需重新标定）',
      found: false,
      kind: 'contenteditable',
      frameworkHints: frameworkHintsFor(ce),
      path: shortPath(ce),
    }
  }
  const kind =
    el instanceof HTMLTextAreaElement
      ? 'textarea'
      : el instanceof HTMLInputElement
        ? 'input'
        : el.getAttribute('contenteditable') === 'true'
          ? 'contenteditable'
          : 'none'
  return {
    note,
    found: true,
    kind,
    frameworkHints: frameworkHintsFor(el),
    path: shortPath(el),
  }
}

/** 与 list.ts extractCardHref 保持一致的判定：真实 job_detail 链接 */
function isRealDetailHref(href: string): boolean {
  return /job_detail\//i.test(href) && !/javascript:/i.test(href)
}

function probeJobCards(limit = 5): JobCardLinkProbe[] {
  const cards = allEl(document, SELECTORS.jobCard).slice(0, limit)
  return cards.map((card, index) => {
    const anchors = Array.from(
      card.querySelectorAll('a[href]'),
    ) as HTMLAnchorElement[]
    const hrefs = anchors.map(
      (a) => a.getAttribute('href') || a.href || '',
    )
    const detail = hrefs.find(isRealDetailHref)
    const dataAttrs: Record<string, string> = {}
    if (card instanceof HTMLElement) {
      for (const [k, v] of Object.entries(card.dataset)) {
        if (typeof v === 'string') dataAttrs[k] = v.slice(0, 60)
      }
    }
    return {
      index,
      title: textOf(card.querySelector(SELECTORS.jobTitle)).slice(0, 40),
      hasDetailAnchor: Boolean(detail),
      detailHref: detail?.slice(0, 120),
      anchorCount: anchors.length,
      anchorHrefs: hrefs.map((h) => h.slice(0, 80)).slice(0, 8),
      dataAttrs,
    }
  })
}

export function probeSelectors(): ProbeReport {
  const selectors: SelectorProbe[] = Object.entries(SELECTORS).map(([k, v]) =>
    probeGroup(k, v as string),
  )

  const textCandidates = collectTextCandidates()
  const redirectAffected = [
    ...(textCandidates.openChat || []),
    ...(textCandidates.sendResume || []),
  ]
    .filter((c) => c.wouldRedirectToCard)
    .map((c) => ({
      text: c.text,
      path: c.path,
      redirectTo: c.redirectTargetPath || '',
    }))

  const toolbarBtnTexts = allEl(document, '.toolbar-btn')
    .slice(0, 12)
    .map((el) => textOf(el).slice(0, 20) || `[${el.tagName.toLowerCase()}]`)

  return {
    ts: Date.now(),
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    pageKind: detectPageKind(),
    jobCards: probeJobCards(),
    selectors,
    textCandidates,
    hypotheses: {
      safeClickRedirect: {
        note:
          'H-A：列表项非空即说明 safeClick 会把该按钮的点击改投到 job-card 祖先，开聊将退化为重开详情且返回假成功',
        affected: redirectAffected,
      },
      chatInput: probeChatInput(),
      salaryRendering: probeSalaryRendering(),
      unreadBadge: probeUnreadBadge(),
      resumeBtnOverbroad: {
        note:
          'H-C：裸 .toolbar-btn 在 sendResumeBtn 选择器中；若下列文案不是「发简历」，说明会误点其他工具栏按钮',
        toolbarBtnTexts,
      },
    },
  }
}
