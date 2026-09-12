/** BOSS 页面选择器 — 对齐本机已跑通的 helper（junwenli / Universal_Job_Helper） */

/**
 * 「立即沟通」—— 按优先级排序（实页探针标定 2026-07）。
 *
 * 要点：
 * - 禁用 `a[ka*="chat"]`：会命中 `ka="job_detail_wechat_share"`（we**chat**）→ 弹微信分享码
 * - 独立详情页真正可点的是 `.btn-startchat-wrap` 内的 `<a>`，不是 wrapper 本体
 * - 列表/抽屉详情头部为 `a.op-btn-chat`
 */
export const OPEN_CHAT_BTN_SELECTORS = [
  'a.op-btn-chat',
  '.job-detail-op a.op-btn-chat',
  '.btn-startchat-wrap a.btn',
  '.btn-startchat-wrap a',
  '[class*="btn-startchat"] a',
  'a.btn-startchat',
  'a.btn.btn-startchat',
  'button.btn-startchat',
  'button.btn.btn-startchat',
  'a[ka^="go_chat"]',
  'a[ka^="cpc_job_list_chat"]',
  'a[ka="job-detail-chat"]',
  'a[ka="job-list-chat"]',
  'a.btn-outline-chat',
  // 兜底：wrapper 本体（依赖事件委托）
  '[class*="btn-startchat"]',
  '.op-btn-chat',
]

/**
 * 发简历确认框—— **必须限定在弹框容器内**。
 *
 * 实页证据：聊天页无任何弹框时，裸 `.btn-sure-v2` 会命中发送按钮
 * `button.btn-v2.btn-sure-v2.btn-send`（可见），导致 isConfirmVisible() 恒为 true，
 * 发简历流程误以为确认框已弹出并去点空。
 */
export const RESUME_CONFIRM_SELECTORS = [
  '.dialog-container .btn-sure-v2:not(.btn-send)',
  '.dialog-wrap .btn-sure-v2:not(.btn-send)',
  '[class*="dialog"] .btn-sure-v2:not(.btn-send)',
  '[class*="dialog"] .btn-sure:not(.btn-send)',
  '.dialog-footer .btn-sure',
  '.resume-dialog .btn-confirm',
]

/**
 * 职位标题 —— 按优先级（实页探针标定 2026-07）。
 *
 * `a.job-name` 必须排在 `.job-title` 之前：实页结构为
 * `div.job-title.clearfix > a.job-name + span.job-salary`，
 * 若取到 wrapper，标题会被薪资污染成「精装修技术负责人-K」。
 */
export const JOB_TITLE_SELECTORS = [
  'a.job-name',
  '.job-name',
  '.job-title .job-name',
  'a.job-card-left .job-name',
  '.job-info .job-name',
  '.job-card-body > .job-title',
  '.job-info .job-title',
  '.job-title',
]

export const SELECTORS = {
  /**
   * 职位列表卡片 — 只取「整卡」根节点
   * 禁止：.job-card-body / .job-primary / [class*="job-card"] / 任意 li
   * （会把公司行、标签行扫成独立「职位」）
   */
  jobCard: [
    'li.job-card-box',
    'li.job-card-wrapper',
    'li.job-card',
    '.job-list-box > li.job-card-box',
    '.job-list-box > li.job-card-wrapper',
    '.rec-job-list > li.job-card-box',
    '.rec-job-list > li.job-card-wrapper',
    'li[class*="job-card-box"]',
    'li[class*="job-card-wrapper"]',
    '[ka="search_list_item"]',
    'li[data-jobid]',
    // 少数布局用 div 整卡（必须带 jobid，避免公司块）
    'div.job-card-wrapper[data-jobid]',
    'div.job-card-box[data-jobid]',
  ].join(','),

  jobTitle: JOB_TITLE_SELECTORS.join(','),

  companyName: [
    '.company-name a',
    '.company-name',
    '.company-text .name',
    '.boss-name',
    '.job-card-footer .company-name',
    '.job-card-body .company-name',
  ].join(','),

  salary: [
    '.salary',
    '.job-info .salary',
    '.job-limit .salary',
    '.job-card-body .salary',
    '.job-salary',
    'span.salary',
  ].join(','),

  city: [
    '.job-area',
    '.job-area-wrapper',
    '.job-address-desc',
    '.company-location',
    '.job-city',
    '[class*="job-area"]',
  ].join(','),

  /**
   * 右侧详情抽屉 / 详情页根
   * helper: .job-detail-box, .job-detail-wrapper
   */
  jobDetailRoot: [
    '.job-detail-box',
    '.job-detail-wrapper',
    '.job-detail-container',
    '.job-detail',
    '#job-detail',
    '.job-body-wrapper',
    '.detail-content',
    '.job-detail-body',
    '.job-drawer',
    '.info-content',
    '[class*="job-detail"]',
  ].join(','),

  /**
   * 职位描述正文
   * helper: .job-sec-text, .job-detail-text, .text.fold-text, .job-description, .detail-content, .job-sec
   * Universal: .job-detail-section .job-description, [data-selector="job-description"]
   */
  jobDesc: [
    '.job-sec-text',
    '.job-detail-section .job-sec-text',
    '.job-detail-section .job-description',
    '.job-detail-section .text',
    '.job-detail-text',
    '.text.fold-text',
    '.job-description',
    '.job-detail-content',
    '[data-selector="job-description"]',
    '.detail-content',
    '.job-sec',
    '.job-detail-section',
    '.job-detail-box .text',
    '.job-detail .text',
    '[class*="job-sec-text"]',
    '[class*="job-sec"] .text',
    '[class*="job-description"]',
  ].join(','),

  openChatBtn: OPEN_CHAT_BTN_SELECTORS.join(','),

  chatInput: [
    '#chat-input',
    '.chat-input',
    '.boss-chat-editor-input',
    '[contenteditable="true"].chat-input',
    'textarea.chat-input',
    '.message-input textarea',
    '[class*="chat-input"]',
  ].join(','),

  chatSend: [
    '.btn-send',
    '.submit-content',
    '.chat-op .submit',
    'button.send-message',
    '.submit-btn',
  ].join(','),

  peerMessage: [
    'li.message-item.item-friend .text',
    '.message-item.item-friend .text',
    '.item-friend .text',
    '.message-item .text',
    '.chat-message .message-content',
    '.message-card .text span',
    '.friend .text',
  ].join(','),

  // 禁止裸 .toolbar-btn：会命中聊天工具栏任意按钮（表情/图片/换电话），
  // 导致发简历变成误点其他功能。文案兑现在 chat.ts 的候选集里做。
  sendResumeBtn: [
    '.toolbar-btn-resume',
    '[ka="chat_resume"]',
    'button.resume-btn',
    '.operate-exchange-resume',
    '.btn-resume',
  ].join(','),

  resumeConfirm: RESUME_CONFIRM_SELECTORS.join(','),

  /** 发简历成功态（toast / 文案 / 按钮变化） */
  resumeSuccess: [
    '.toast-success',
    '.toast-text',
    '.boss-toast',
    '[class*="toast"]',
    '.exchange-resume-success',
  ].join(','),

  /**
   * 聊天侧栏会话列表项（含新版消息页：头像+姓名公司|职位+预览）
   */
  chatSessionItem: [
    '.geek-item',
    '.friend-list-item',
    '.chat-friend-item',
    '.user-list .user-item',
    'li.geek-item-wrap',
    '.chat-user-list li',
    '.friend-content-wrap .friend-list li',
    '[class*="geek-item"]',
    '[class*="friend-list"] > li',
    '.session-list-item',
    // 新版沟通列表
    '.chat-container .user-list li',
    '.conversation-list li',
    '[class*="conversation"] li',
    '[class*="chat-list"] li',
    '.chat-left li',
    '#container .chat-user li',
    'div[role="listitem"]',
  ].join(','),

  chatSessionTitle: [
    '.geek-name',
    '.friend-name',
    '.name-box .name',
    '.title-box .title',
    '.user-name',
    '.chat-name',
    '[class*="geek-name"]',
    '[class*="friend-name"]',
    '.name-text',
    '[class*="name-box"]',
  ].join(','),

  chatSessionCompany: [
    '.company-name',
    '.source-job',
    '.job-name',
    '.position-name',
    '.gray',
    '.sub-title',
    '[class*="company"]',
    '[class*="source-job"]',
    '.base-info',
  ].join(','),

  chatSessionPreview: [
    '.push-text',
    '.last-message',
    '.msg-text',
    '.content-text',
    '.gray.ellipsis',
    '[class*="last-msg"]',
    '.text.ellipsis',
    '[class*="preview"]',
  ].join(','),

  /**
   * 会话行未读徐标。
   *
   * 启发式默认值，**需实页标定**：跑侧栏「选择器自检」看
   * hypotheses.unreadBadge 的命中情况。宁可漏报不可误报：
   * 误报会把无新消息的会话排到前面，白耗点击次数。
   */
  chatSessionUnread: [
    '.badge-count',
    '.unread-count',
    '.red-dot',
    '.dot-unread',
    '[class*="badge"]',
    '[class*="unread"]',
    '[class*="red-point"]',
    '[class*="reddot"]',
  ].join(','),

  /** 登录 / 验证码检测 */
  loginForm: [
    'input[type="password"]',
    '.login-form',
    '.login-pwd',
    '#login',
    '.sign-form',
    '[class*="login-form"]',
    'form[action*="login"]',
  ].join(','),

  // 禁止过宽的 [class*="captcha"]：详情页大量无关 class 会误触 auth pause
  captchaRoot: [
    '.geetest_panel',
    '.geetest_holder',
    '.geetest_widget',
    '#captcha',
    '.captcha-box',
    'iframe[src*="captcha"]',
    'iframe[src*="geetest"]',
    '.nc-container',
    '#nc_1_n1z',
    '.nc_scale',
  ].join(','),

  profileRoot: [
    '.resume-detail',
    '.resume-detail-wrap',
    '.user-resume',
    '.geek-resume',
    '.geek-resume-card',
    '.resume-box',
    '.resume-content',
    '#resume',
    '[class*="resume-detail"]',
  ].join(','),
} as const

export function firstEl(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector)
  } catch {
    return null
  }
}

export function allEl(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector))
  } catch {
    return []
  }
}

/**
 * 按**列表顺序**逐条尝试，返回首个命中项。
 *
 * 必要性：`querySelector('a,b,c')` 返回的是 **DOM 序**首个命中任一分支的元素，
 * 而非列表中靠前分支的命中项。之前把优先级写在逆序列表里是无效的。
 */
export function firstByOrderedSelectors(
  root: ParentNode,
  selectors: readonly string[],
  filter?: (el: Element) => boolean,
): Element | null {
  for (const sel of selectors) {
    for (const el of allEl(root, sel)) {
      if (!filter || filter(el)) return el
    }
  }
  return null
}

export function textOf(el: Element | null | undefined): string {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim()
}

/** 粗略可见性：避免点到隐藏/零尺寸的影子节点 */
export function isRoughlyVisible(el: Element | null | undefined): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  try {
    const st = window.getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') {
      return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 2 && r.height > 2
  } catch {
    return false
  }
}

export function hrefOf(el: Element | null | undefined): string {
  if (!el) return ''
  if (el instanceof HTMLAnchorElement) return el.getAttribute('href') || el.href || ''
  if (el.tagName === 'A') return el.getAttribute('href') || ''
  return ''
}

/** BOSS 大量 a[href=javascript:]；扩展 content script 的 CSP 禁止执行 javascript: URL */
export function isJavascriptHref(el: Element | null | undefined): boolean {
  const href = hrefOf(el) || (el?.closest?.('a') ? hrefOf(el.closest('a')) : '')
  return /^\s*javascript:/i.test(href)
}

type AnchorPatch = {
  a: HTMLAnchorElement
  target: string | null
}

/** 点击前临时改写卡片内 a：仅将 _blank 转为 _self，绝对保留 href 属性 */
function patchAnchorsForSafeClick(root: HTMLElement): AnchorPatch[] {
  const saved: AnchorPatch[] = []
  const list: HTMLAnchorElement[] = []
  if (root.tagName === 'A') list.push(root as HTMLAnchorElement)
  const parentA = root.closest('a') as HTMLAnchorElement | null
  if (parentA) list.push(parentA)
  list.push(...Array.from(root.querySelectorAll<HTMLAnchorElement>('a[target]')))

  const seen = new Set<HTMLAnchorElement>()
  for (const a of list) {
    if (seen.has(a)) continue
    seen.add(a)
    const target = a.getAttribute('target')

    // 强制同标签：避免 BOSS 详情 a[target=_blank] 被打开一堆新标签
    // 注意：绝对不能 removeAttribute('href')，否则 <a> 会丧失超链接语义与 jQuery/React 事件委托匹配！
    if (target && /_blank/i.test(target)) {
      saved.push({ a, target })
      a.setAttribute('target', '_self')
    }
  }
  return saved
}

function restoreAnchors(saved: AnchorPatch[]) {
  for (const { a, target } of saved) {
    if (target == null) a.removeAttribute('target')
    else a.setAttribute('target', target)
  }
}

export const CARD_ROOT_SELECTOR = [
  'li.job-card-wrapper',
  'li.job-card-box',
  '.job-card-wrapper',
  '.job-card-box',
  '.job-card-body',
  '.job-primary',
  '[class*="job-card"]',
].join(',')

/**
 * 决定实际接收点击的元素
 * 仅当 resolveCard 为真时才上提到职位卡根节点。
 */
export function resolveClickTarget(
  el: HTMLElement,
  opts: { resolveCard?: boolean } = {},
): HTMLElement {
  if (!opts.resolveCard) return el
  return (el.closest(CARD_ROOT_SELECTOR) as HTMLElement | null) || el
}

export function safeClick(
  el: Element | null | undefined,
  opts: { resolveCard?: boolean } = {},
): boolean {
  if (!el || !(el instanceof HTMLElement)) return false

  const target = resolveClickTarget(el, opts)

  try {
    target.scrollIntoView({ block: 'center', inline: 'nearest' })
  } catch {
    /* ignore */
  }

  const saved = patchAnchorsForSafeClick(target)

  try {
    let cx = 10
    let cy = 10
    try {
      const rect = target.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        cx = Math.round(rect.left + rect.width / 2)
        cy = Math.round(rect.top + rect.height / 2)
      }
    } catch {
      /* ignore */
    }

    try {
      target.focus()
    } catch {
      /* ignore */
    }

    const mouseBase: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: cx,
      clientY: cy,
      screenX: cx + (typeof window !== 'undefined' ? window.screenX || 0 : 0),
      screenY: cy + (typeof window !== 'undefined' ? window.screenY || 0 : 0),
      button: 0,
    }

    // 1. Pointer over & enter
    if (typeof PointerEvent !== 'undefined') {
      try {
        target.dispatchEvent(new PointerEvent('pointerover', { ...mouseBase, pointerId: 1, pointerType: 'mouse' }))
        target.dispatchEvent(new PointerEvent('pointerenter', { ...mouseBase, bubbles: false, pointerId: 1, pointerType: 'mouse' }))
      } catch {
        /* ignore */
      }
    }

    // 2. Mouse over & enter
    try {
      target.dispatchEvent(new MouseEvent('mouseover', mouseBase))
      target.dispatchEvent(new MouseEvent('mouseenter', { ...mouseBase, bubbles: false }))
    } catch {
      /* ignore */
    }

    // 3. Pointer down & Mouse down (buttons: 1)
    if (typeof PointerEvent !== 'undefined') {
      try {
        target.dispatchEvent(new PointerEvent('pointerdown', { ...mouseBase, buttons: 1, isPrimary: true, pointerId: 1, pointerType: 'mouse' }))
      } catch {
        /* ignore */
      }
    }
    target.dispatchEvent(new MouseEvent('mousedown', { ...mouseBase, buttons: 1 }))

    // 4. Pointer up & Mouse up (buttons: 0)
    if (typeof PointerEvent !== 'undefined') {
      try {
        target.dispatchEvent(new PointerEvent('pointerup', { ...mouseBase, buttons: 0, isPrimary: true, pointerId: 1, pointerType: 'mouse' }))
      } catch {
        /* ignore */
      }
    }
    target.dispatchEvent(new MouseEvent('mouseup', { ...mouseBase, buttons: 0 }))

    // 5. Click event (buttons: 0)
    target.dispatchEvent(new MouseEvent('click', { ...mouseBase, buttons: 0 }))

    // 6. 向可能存在的内部 child 派发点击，满足内层委托
    const child = target.querySelector('span, i, b, div, p')
    if (child && child instanceof HTMLElement) {
      try {
        child.dispatchEvent(new MouseEvent('click', { ...mouseBase, buttons: 0 }))
      } catch {
        /* ignore */
      }
    }

    // 7. 原生 .click() 触发
    try {
      if (typeof target.click === 'function') {
        target.click()
      }
    } catch {
      /* ignore if blocked */
    }

    return true
  } catch {
    return false
  } finally {
    setTimeout(() => restoreAnchors(saved), 500)
  }
}

/** 点击「展开/查看更多」类按钮，尽量露出完整 JD */
export function clickExpandButtons(root: ParentNode = document): number {
  const labels = ['展开', '查看全部', '查看更多', '显示全部', '更多']
  let clicked = 0
  const nodes = Array.from(
    (root as Document | Element).querySelectorAll?.('a,button,span,div') ?? [],
  )
  for (const n of nodes) {
    const t = textOf(n)
    if (!t || t.length > 16) continue
    if (!labels.some((l) => t.includes(l))) continue
    // 一律走 safeClick（内部会剥离 javascript:）
    if (safeClick(n)) clicked++
  }
  return clicked
}

export function isElementDisabled(el: Element | null | undefined): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'button' || tag === 'a') {
    if ((el as any).disabled) return true
    if (el.hasAttribute('disabled')) return true
    if (el.getAttribute('aria-disabled') === 'true') return true
    const cls = (el.className || '').toLowerCase()
    if (cls.includes('is-disabled') || cls.includes('disabled')) return true
  }
  return false
}
