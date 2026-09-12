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

const OPEN_CHAT_TEXT_RE = /立即沟通|继续沟通|^开聊$|沟通一下|马上沟通|聊一聊|打招呼/

function collectOpenChatCandidates(opts?: {
  /** 为 true 时不要求 isRoughlyVisible（后台 tab 常 0 尺寸，先 scroll 再点） */
  allowHidden?: boolean
}): HTMLElement[] {
  const root = findDetailRoot()
  const allowHidden = opts?.allowHidden === true
  const seen = new Set<HTMLElement>()
  const push = (el: Element | null | undefined) => {
    if (!(el instanceof HTMLElement) || seen.has(el)) return
    if (!allowHidden && !isRoughlyVisible(el)) return
    seen.add(el)
  }

  // 按优先级而非 DOM 序取：避免拿到 wrapper 或「微信扫码分享」
  push(
    firstByOrderedSelectors(
      root,
      OPEN_CHAT_BTN_SELECTORS,
      allowHidden ? undefined : isRoughlyVisible,
    ),
  )
  push(
    firstByOrderedSelectors(
      document,
      OPEN_CHAT_BTN_SELECTORS,
      allowHidden ? undefined : isRoughlyVisible,
    ),
  )
  // 选择器全未命中时：再扫一遍不带可见性过滤的选择器命中
  if (seen.size === 0) {
    push(firstByOrderedSelectors(root, OPEN_CHAT_BTN_SELECTORS))
    push(firstByOrderedSelectors(document, OPEN_CHAT_BTN_SELECTORS))
  }

  for (const el of Array.from(
    document.querySelectorAll('a,button,[role="button"],span,div'),
  )) {
    const t = textOf(el)
    // 限长：避免命中包含该文案的大容器
    if (!t || t.length > 16) continue
    if (!OPEN_CHAT_TEXT_RE.test(t)) continue
    // 取最内层
    if (Array.from(el.children).some((c) => OPEN_CHAT_TEXT_RE.test(textOf(c)))) {
      continue
    }
    // span/div 文案命中时优先点可点祖先
    const clickable =
      el.closest('a,button,[role="button"]') instanceof HTMLElement
        ? (el.closest('a,button,[role="button"]') as HTMLElement)
        : (el as HTMLElement)
    push(clickable)
  }

  return Array.from(seen)
}

/**
 * 点「立即沟通」。
 *
 * 只负责「点下去」并回报点中了什么；**是否真的进了会话由调用方校验**。
 * 旧实现返回裸 boolean，叠加 safeClick 的卡片重定向，产生“点了但没开聊”的假成功。
 *
 * 2026-08 修复：后台详情 tab 上按钮常存在但 getBoundingClientRect=0（未布局），
 * 原先 isRoughlyVisible 过滤后候选=0；现先 scrollIntoView 再放宽一轮。
 */
export function clickOpenChat(): OpenChatClick {
  let candidates = collectOpenChatCandidates({ allowHidden: false })
  if (!candidates.length) {
    candidates = collectOpenChatCandidates({ allowHidden: true })
    for (const el of candidates) {
      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
      } catch {
        /* ignore */
      }
    }
  }

  if (!candidates.length) {
    const href = location.href.slice(0, 120)
    const onChat = /\/web\/geek\/chat/i.test(location.href)
    const onDetail = /job_detail\//i.test(location.href)
    return {
      ok: false,
      candidates: 0,
      error: onChat
        ? '当前已在聊天页，页面无「立即沟通」（应由上层按已开聊处理）'
        : onDetail
          ? '详情页未找到「立即沟通/继续沟通」按钮（可能未渲染完或选择器过期）'
          : `页面无「立即沟通」候选（非详情页：${href}）`,
    }
  }

  for (const btn of candidates) {
    // safeClick 会临时剥离 javascript: href，只派发鼠标事件（不调用 element.click）
    // 不开 resolveCard：绝不把按钮点击改投到职位卡
    if (isElementDisabled(btn)) continue
    try {
      btn.scrollIntoView({ block: 'center', inline: 'nearest' })
    } catch {
      /* ignore */
    }
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

export type OpenChatCheckResult =
  | { status: 'success'; via: string; detail?: string }
  | { status: 'failed'; error: string; terminal?: boolean }
  | { status: 'pending' }

const CHAT_SUCCESS_TOAST_RE =
  /打招呼成功|已向Boss发送|打招呼语已发送|沟通成功|已发起沟通|已向对方发起|已沟通|发送成功|简历已送达|与Boss沟通中/i
const CHAT_LIMIT_TOAST_RE =
  /今日打招呼已达上限|沟通人数已达上限|今日沟通次数已用完|达到上限|今日沟通上限|打招呼次数已达上限/i
const CHAT_FREQ_LIMIT_RE = /打招呼过于频繁|操作过于频繁|请稍后再试|请勿频繁操作/i
const CHAT_ALREADY_RE = /已被开聊|已与该Boss沟通过|您已与该Boss|已沟通过该职位/i

const DIALOG_CONFIRM_SELECTORS = [
  '.dialog-footer .btn-sure',
  '.dialog-footer .btn-sure-v2',
  '.dialog-wrap .btn-sure',
  '.dialog-wrap .btn-sure-v2',
  '.dialog-container .btn-sure',
  '.dialog-container .btn-sure-v2',
  'button.btn-sure-v2',
  'button.btn-sure',
  'button.btn-confirm',
  '.btn-confirm',
  '.dialog-btn-confirm',
  'button[ka*="send"]',
  'button[ka*="greet"]',
  '.greet-boss-dialog .btn',
  '.greet-dialog .btn',
]

export const CHAT_READY_SELECTORS = [
  '#chat-input',
  '.chat-input',
  '.boss-chat-editor-input',
  '[contenteditable="true"].chat-input',
  'textarea.chat-input',
  '.chat-conversation',
  '.message-list',
  '.chat-dialog',
  '.chat-box',
  '.dialog-chat',
  '[class*="chat-container"]',
  '[class*="chat-editor"]',
  '[class*="chat-conversation"]',
  '.chat-message-list',
  '.chat-record-list',
  '.chat-area',
  '[class*="dialog-chat"]',
  '.greet-boss-dialog',
]

/**
 * 校验开聊状态（多维探针）：
 * 1. 页面已导航到 /chat 聊天页
 * 2. 页面中已出现聊天输入或会话容器
 * 3. 页面出现可见的图形验证码控件
 * 4. 出现可见的打招呼成功/失败 Toast 提示
 * 5. 出现打招呼确认弹窗并自动确认
 * 6. 详情页按钮文案已变为「继续沟通 / 已沟通 / 沟通中 / 已打招呼 / 聊一聊」
 */
export function checkOpenChatProgress(): OpenChatCheckResult {
  // 1. 页面已直接跳到聊天 URL
  if (/\/web\/geek\/chat|\/chat/i.test(location.href)) {
    return { status: 'success', via: 'navigated' }
  }

  // 2. 检查是否有真实可见的验证码控件（绝不用 body 全文匹配，避免页脚/侧边栏「安全中心」误判）
  const captchaEl = firstEl(document, SELECTORS.captchaRoot) as HTMLElement | null
  if (captchaEl && isRoughlyVisible(captchaEl)) {
    return { status: 'failed', error: '触发安全验证（需人工处理）', terminal: true }
  }

  // 3. 检查可见的 Toast 提示
  const toastNodes = allEl(
    document,
    '.toast-text, .boss-toast, .toast-success, .toast-content, [class*="toast"], .message-toast, div[role="alert"], [class*="error-tip"]',
  )
  for (const n of toastNodes) {
    if (!isRoughlyVisible(n)) continue
    const t = textOf(n)
    if (CHAT_LIMIT_TOAST_RE.test(t)) {
      return { status: 'failed', error: '今日打招呼已达 BOSS 平台上限', terminal: true }
    }
    if (CHAT_FREQ_LIMIT_RE.test(t)) {
      return { status: 'failed', error: '打招呼过于频繁，触发平台限频', terminal: true }
    }
    if (/请完成安全验证|请先完成滑动验证|滑动验证码|图形验证/i.test(t)) {
      return { status: 'failed', error: '触发安全验证（需人工处理）', terminal: true }
    }
    if (CHAT_ALREADY_RE.test(t)) {
      return { status: 'success', via: 'already_contacted' }
    }
    if (CHAT_SUCCESS_TOAST_RE.test(t)) {
      return { status: 'success', via: 'toast_success', detail: t.slice(0, 40) }
    }
  }

  // 4. 检查是否有聊天 UI 出现
  for (const sel of CHAT_READY_SELECTORS) {
    const el = firstEl(document, sel)
    if (el && isRoughlyVisible(el)) {
      return { status: 'success', via: 'chat_ui', detail: sel }
    }
  }

  // 5. 检查打招呼确认弹窗并自动确认
  const dialog = firstEl(
    document,
    '.dialog-container, .dialog-wrap, .boss-dialog, .greet-dialog, .dialog-box, .start-chat-dialog, [class*="dialog-startchat"], [class*="greet-boss"]',
  )
  if (dialog && isRoughlyVisible(dialog)) {
    const dialogText = textOf(dialog)
    if (CHAT_LIMIT_TOAST_RE.test(dialogText)) {
      return { status: 'failed', error: '今日打招呼已达 BOSS 平台上限', terminal: true }
    }
    const confirmBtn = firstByOrderedSelectors(
      dialog,
      DIALOG_CONFIRM_SELECTORS,
      isRoughlyVisible,
    )
    if (confirmBtn) {
      safeClick(confirmBtn)
      return { status: 'pending' }
    }
    // 文案反查弹窗内的确定按钮
    for (const btn of allEl(dialog, 'button, a, span, div')) {
      const bt = textOf(btn)
      if (
        /^\s*(确定|确认|立即发送|发送打招呼语|留电话|投递简历|发简历)\s*$/.test(bt) &&
        isRoughlyVisible(btn)
      ) {
        safeClick(btn)
        return { status: 'pending' }
      }
    }
    // 弹窗本身若为打招呼成功弹窗
    if (CHAT_SUCCESS_TOAST_RE.test(dialogText)) {
      return { status: 'success', via: 'dialog_success' }
    }
  }

  // 6. 检查详情页按钮是否转为「继续沟通 / 已沟通 / 沟通中 / 已打招呼 / 聊一聊」
  const actionButtons = allEl(
    document,
    'a, button, [role="button"], .btn, [class*="btn-startchat"], .op-btn-chat',
  )
  for (const b of actionButtons) {
    if (!isRoughlyVisible(b)) continue
    const t = textOf(b)
    if (/继续沟通|已沟通|沟通中|已打招呼|聊一聊|已投递/.test(t) && t.length <= 16) {
      return { status: 'success', via: 'button_state_changed', detail: t }
    }
    const cls = (b.className || '').toLowerCase()
    if (cls.includes('btn-continue') || cls.includes('has-chat')) {
      return { status: 'success', via: 'button_state_changed', detail: cls }
    }
  }

  return { status: 'pending' }
}
