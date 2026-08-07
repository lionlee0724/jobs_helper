import {
  SELECTORS,
  firstEl,
  textOf,
  allEl,
  clickExpandButtons,
  safeClick,
  isRoughlyVisible,
  firstByOrderedSelectors,
  OPEN_CHAT_BTN_SELECTORS,
  isElementDisabled,
} from './selectors'

function cleanDesc(raw: string): string {
  return raw
    .replace(/登录|注册|下载APP|立即沟通|继续沟通|不感兴趣|举报|分享|BOSS直聘/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function scoreDesc(text: string): number {
  if (!text) return 0
  let s = Math.min(text.length, 4000)
  if (/(岗位职责|职位描述|任职要求|工作职责|岗位要求|职位要求)/.test(text)) s += 800
  if (/(任职|要求|职责|福利|经验)/.test(text)) s += 120
  // 惩罚明显导航/筛选噪声
  if (/(筛选|工作区域|职位类型不限|地铁不限)/.test(text)) s -= 500
  if (text.length < 40) s -= 200
  return s
}

function bestText(els: Element[]): string {
  let best = ''
  let bestScore = -1
  for (const el of els) {
    const t = cleanDesc(textOf(el))
    const sc = scoreDesc(t)
    if (sc > bestScore) {
      bestScore = sc
      best = t
    }
  }
  return best
}

function findDetailRoot(): Element {
  return (
    firstEl(document, SELECTORS.jobDetailRoot) ||
    firstEl(document, '[class*="job-detail"]') ||
    firstEl(document, 'main') ||
    document.body
  )
}

/** 404 / 职位下线 / 安全页 — 这类页面 body 很长但无有效 JD */
export function isDeadJobPage(): boolean {
  const t = `${document.title} ${textOf(document.body)}`.slice(0, 2000)
  return (
    /页面不存在|职位不存在|该职位已|已下线|找不到页面|404|访问的页面不存在|您访问的页面/.test(
      t,
    ) || /security_check|verify\.html|账户存在异常/.test(location.href + t)
  )
}

function collectDescCandidates(root: Element): Element[] {
  const set = new Set<Element>()
  for (const el of [
    ...allEl(root, SELECTORS.jobDesc),
    ...allEl(document, SELECTORS.jobDesc),
    ...allEl(document, '[class*="sec-text"]'),
    ...allEl(document, '[class*="job-sec"]'),
    ...allEl(document, '[class*="job-description"]'),
    ...allEl(document, '.fold-text'),
  ]) {
    set.add(el)
  }
  return [...set]
}

/** 从当前页/右侧详情抽屉提取 JD */
export function extractJobDetail(): {
  desc: string
  title?: string
  company?: string
  salary?: string
  city?: string
  deadPage?: boolean
  debug?: {
    descLen: number
    rootFound: boolean
    rootClass: string
    href: string
    candidateCount: number
    bestScore: number
    deadPage?: boolean
  }
} {
  if (isDeadJobPage()) {
    return {
      desc: '',
      deadPage: true,
      debug: {
        descLen: 0,
        rootFound: false,
        rootClass: '',
        href: location.href.slice(0, 160),
        candidateCount: 0,
        bestScore: 0,
        deadPage: true,
      },
    }
  }

  clickExpandButtons(document)

  const root = findDetailRoot()
  const rootFound = Boolean(
    firstEl(document, SELECTORS.jobDetailRoot) || firstEl(document, '[class*="job-detail"]'),
  )

  const candidates = collectDescCandidates(root)
  let desc = bestText(candidates)
  let bestScore = scoreDesc(desc)

  // 合并多个 section（职位描述 + 任职要求）
  if (desc.length < 80) {
    const sections = allEl(
      root,
      '.job-detail-section, [class*="detail-section"], [class*="job-sec"], .job-sec',
    )
    const merged = cleanDesc(
      sections
        .map((s) => textOf(s))
        .filter((t) => t.length > 15)
        .join('\n'),
    )
    if (scoreDesc(merged) > bestScore) {
      desc = merged
      bestScore = scoreDesc(merged)
    }
  }

  // 详情根节点全文
  if (desc.length < 40) {
    const rootText = cleanDesc(textOf(root))
    if (scoreDesc(rootText) > bestScore) {
      desc = rootText
      bestScore = scoreDesc(rootText)
    }
  }

  // 独立详情页 body 兜底
  if (desc.length < 40 && /job_detail/.test(location.href)) {
    const body = cleanDesc(textOf(document.body)).slice(0, 8000)
    if (scoreDesc(body) > bestScore) {
      desc = body
      bestScore = scoreDesc(body)
    }
  }

  // 带「岗位职责」关键词的任意大块
  if (desc.length < 60) {
    const blocks = allEl(document, 'div,section,article,p')
      .map((el) => cleanDesc(textOf(el)))
      .filter((t) => t.length >= 80 && t.length <= 6000 && /(岗位职责|职位描述|任职要求)/.test(t))
    for (const t of blocks) {
      if (scoreDesc(t) > bestScore) {
        desc = t
        bestScore = scoreDesc(t)
      }
    }
  }

  const title =
    textOf(firstEl(root, SELECTORS.jobTitle)) ||
    textOf(firstEl(document, SELECTORS.jobTitle)) ||
    undefined
  const company =
    textOf(firstEl(root, SELECTORS.companyName)) ||
    textOf(firstEl(document, SELECTORS.companyName)) ||
    undefined
  const salary =
    textOf(firstEl(root, SELECTORS.salary)) ||
    textOf(firstEl(document, SELECTORS.salary)) ||
    undefined
  const city =
    textOf(firstEl(root, SELECTORS.city)) ||
    textOf(firstEl(document, SELECTORS.city)) ||
    undefined

  return {
    desc,
    title,
    company,
    salary,
    city,
    debug: {
      descLen: desc.length,
      rootFound,
      rootClass: (root as HTMLElement).className?.toString?.().slice(0, 80) || '',
      href: location.href.slice(0, 160),
      candidateCount: candidates.length,
      bestScore,
    },
  }
}

export type OpenChatClick = {
  ok: boolean
  /** 实际点到的元素证据，用于标定与排错 */
  clicked?: { tag: string; cls: string; text: string }
  candidates: number
  error?: string
}

/**
 * 点「立即沟通」。
 *
 * 只负责「点下去」并回报点中了什么；**是否真的进了会话由调用方校验**。
 * 旧实现返回裸 boolean，叠加 safeClick 的卡片重定向，产生“点了但没开聊”的假成功。
 */
export function clickOpenChat(): OpenChatClick {
  const root = findDetailRoot()
  const seen = new Set<HTMLElement>()
  const push = (el: Element | null | undefined) => {
    if (el instanceof HTMLElement && !seen.has(el) && isRoughlyVisible(el)) {
      seen.add(el)
    }
  }

  // 按优先级而非 DOM 序取：避免拿到 wrapper 或「微信扫码分享」
  push(firstByOrderedSelectors(root, OPEN_CHAT_BTN_SELECTORS, isRoughlyVisible))
  push(
    firstByOrderedSelectors(document, OPEN_CHAT_BTN_SELECTORS, isRoughlyVisible),
  )
  for (const el of Array.from(
    document.querySelectorAll('a,button,[role="button"]'),
  )) {
    const t = textOf(el)
    // 限长：避免命中包含该文案的大容器
    if (!t || t.length > 12) continue
    if (!/立即沟通|继续沟通|^开聊$|沟通一下|马上沟通/.test(t)) continue
    // 取最内层
    if (Array.from(el.children).some((c) => /沟通|开聊/.test(textOf(c)))) continue
    push(el)
  }

  const candidates = Array.from(seen)
  if (!candidates.length) {
    return {
      ok: false,
      candidates: 0,
      error: '页面无可见的「立即沟通」候选元素',
    }
  }

  for (const btn of candidates) {
    // safeClick 会临时剥离 javascript: href，只派发鼠标事件（不调用 element.click）
    // 不开 resolveCard：绝不把按钮点击改投到职位卡
    if (btn instanceof HTMLElement && isElementDisabled(btn)) continue;
    if (safeClick(btn)) {
      return {
        ok: true,
        candidates: candidates.length,
        clicked: {
          tag: btn.tagName.toLowerCase(),
          cls: String(btn.className || '').slice(0, 80),
          text: textOf(btn).slice(0, 30),
        },
      }
    }
  }
  return {
    ok: false,
    candidates: candidates.length,
    error: '候选元素全部点击失败',
  }
}

/**
 * 仅接受「真实」详情 URL。禁止根据 id 拼 /job_detail/{id}.html
 * （推荐页 id 往往不是可直接打开的 encrypt 路径，会 404）
 */
export function jobDetailUrl(_jobId: string): string | null {
  return null
}

export function isRealJobDetailHref(href?: string | null): boolean {
  return Boolean(href && /job_detail\//i.test(href) && !/javascript:/i.test(href))
}
