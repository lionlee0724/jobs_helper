import { BOSS_URLS } from '../../../shared/boss-urls'
import type { ChatSessionMatch } from '../../../shared/messages'
import {
  pickBestSession,
  type ChatSessionItem,
} from '../../../domain/chat-match'
import type { ActionTiming } from '../../../shared/types'
import { waitIn } from '../../humanize'
import {
  SELECTORS,
  firstEl,
  allEl,
  textOf,
  safeClick,
  isRoughlyVisible,
  firstByOrderedSelectors,
  RESUME_CONFIRM_SELECTORS,
} from './selectors'

export function readPeerMessages(limit = 10): string[] {
  // Prefer friend/peer bubbles only — broad `.message-item .text` can include own
  // messages and would re-trigger auto-reply after we send (AC2).
  const friendOnly = [
    'li.message-item.item-friend .text',
    '.message-item.item-friend .text',
    '.item-friend .text',
    '.friend .text',
    '.message-item.item-other .text',
    '.item-other .text',
  ].join(',')
  let nodes = Array.from(document.querySelectorAll(friendOnly))
  if (!nodes.length) {
    // Fallback: full selector, but drop obvious self bubbles
    nodes = Array.from(document.querySelectorAll(SELECTORS.peerMessage)).filter(
      (n) =>
        !n.closest(
          '.item-myself, .item-me, .message-item.item-self, .self, [class*="item-me"]',
        ),
    )
  }
  const texts = nodes
    .map((n) => textOf(n))
    .filter(Boolean)
    .slice(-limit)
  return texts
}

/** 读当前输入框内容（textarea/input 与 contenteditable 统一） */
function readInputValue(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    return input.value
  }
  return (input.textContent || '').trim()
}

/**
 * 向输入框写入文本。
 *
 * contenteditable 分支必须走 execCommand('insertText')：它会产生
 * beforeinput/input 事件并同步更新 selection，React/Vue 受控编辑器才会感知。
 * 旧实现直接赋 textContent + 派发非可信 InputEvent，框架内部 state 仍为空，
 * 发出去的是空消息或根本不发。
 */
/** 清空 contenteditable 内容并把光标置于其中 */
function selectAllIn(input: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(input)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/**
 * 逐字输入（仅 contenteditable）。
 *
 * 整段文本瞬时出现是明显的自动化特征；逐字 insertText 会产生与人工
 * 输入一致的 beforeinput/input 事件序列。
 */
async function typeIntoContentEditable(
  input: HTMLElement,
  text: string,
  charRange: [number, number],
): Promise<void> {
  input.focus()
  selectAllIn(input)
  try {
    document.execCommand('delete', false)
  } catch {
    input.textContent = ''
  }
  for (const ch of Array.from(text)) {
    try {
      if (!document.execCommand('insertText', false, ch)) {
        input.textContent = (input.textContent || '') + ch
        input.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }),
        )
      }
    } catch {
      input.textContent = (input.textContent || '') + ch
    }
    await waitIn(charRange)
  }
}

function writeInput(input: HTMLElement, text: string): void {
  input.focus()
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )?.set
    // 绕过 React 对 value 的拦截，否则 setState 不触发
    if (setter) setter.call(input, text)
    else input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }

  // contenteditable
  selectAllIn(input)

  let inserted = false
  try {
    inserted = document.execCommand('insertText', false, text)
  } catch {
    inserted = false
  }
  if (!inserted) {
    // 降级：至少把文本放进去，并尽量走 beforeinput/input 对
    input.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      }),
    )
    input.textContent = text
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text,
      }),
    )
  }
}

export type SendTextResult = {
  ok: boolean
  /** true = 输入框已清空，强发送成功信号 */
  verified: boolean
  error?: string
}

/**
 * 发送聊天文本，并校验结果。
 *
 * 校验依据：发送成功后聊天框会被清空。未清空不等于一定失败，
 * 因此区分 ok / verified 两个字段，不把不确定谎报为成功。
 */
export async function sendText(
  text: string,
  timing?: ActionTiming,
): Promise<SendTextResult> {
  const input = firstEl(document, SELECTORS.chatInput) as HTMLElement | null
  if (!input) {
    return { ok: false, verified: false, error: '未找到聊天输入框（请标定 selectors.chatInput）' }
  }

  const charRange = timing?.typingCharMs
  const isEditable =
    !(input instanceof HTMLTextAreaElement) && !(input instanceof HTMLInputElement)

  if (isEditable && charRange && charRange[1] > 0) {
    await typeIntoContentEditable(input, text, charRange)
  } else {
    writeInput(input, text)
  }
  await sleep(120)

  // 发送前的检查停顿
  await waitIn(timing?.preSendMs)

  const written = readInputValue(input)
  if (!written.trim()) {
    return {
      ok: false,
      verified: false,
      error: '文本未能写入输入框（编辑器可能拦截了注入）',
    }
  }

  const send = firstEl(document, SELECTORS.chatSend) as HTMLElement | null
  if (send && isRoughlyVisible(send)) {
    safeClick(send)
  } else {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  // 输入框清空 = 已发出
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    await sleep(150)
    if (!readInputValue(input).trim()) {
      return { ok: true, verified: true }
    }
  }

  return {
    ok: false,
    verified: false,
    error: '已写入文本但输入框未清空，无法确认已发送（fail-closed）',
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function pageHasText(re: RegExp): boolean {
  try {
    const t = document.body?.innerText || ''
    return re.test(t)
  } catch {
    return false
  }
}

function hasResumeSuccessSignal(): boolean {
  if (pageHasText(/已发送|发送成功|简历已送达|已成功发送/)) return true
  const nodes = allEl(document, SELECTORS.resumeSuccess)
  for (const n of nodes) {
    const t = textOf(n)
    if (/已发送|发送成功|简历|成功/.test(t) && t.length < 80) return true
  }
  // 发简历按钮 disabled 或文案变化
  const btn = firstEl(document, SELECTORS.sendResumeBtn) as HTMLElement | null
  if (btn) {
    if ((btn as HTMLButtonElement).disabled) return true
    const t = textOf(btn)
    if (/已发|已送/.test(t)) return true
  }
  return false
}

function hasResumeErrorSignal(): boolean {
  return pageHasText(/发送失败|操作失败|请稍后|频繁|无法发送|暂不能/)
}

/**
 * 找弹框里可见的确认按钮。
 *
 * 旧实现用 firstEl(逗号列表) 取 DOM 序首个，常常拿到不可见的「提交」；
 * 且裸 .btn-sure-v2 会命中聊天发送按钮 → 恒判「确认框已弹出」。
 */
function findVisibleConfirm(): HTMLElement | null {
  return firstByOrderedSelectors(
    document,
    RESUME_CONFIRM_SELECTORS,
    isRoughlyVisible,
  ) as HTMLElement | null
}

function isConfirmVisible(): boolean {
  return Boolean(findVisibleConfirm())
}

/**
 * 发简历：点按钮 → 等确认 → 点确认 → 校验成功态。
 * fail-closed：超时无确认且无成功态 / 明确错误 → ok:false
 */
/**
 * 定位发简历按钮。
 *
 * 先走窄选择器；失败后用**可见文案**兑现最内层节点。
 * 绝不回退到裸 .toolbar-btn（会误点表情/图片/换电话）。
 */
function findResumeButton(): HTMLElement | null {
  const bySelector = allEl(document, SELECTORS.sendResumeBtn).find((el) =>
    isRoughlyVisible(el),
  )
  if (bySelector) return bySelector as HTMLElement

  // 实页证据：发简历是 div.toolbar-btn，与「换电话」「换微信」同类同结构，
  // 唯一可靠的区分维度是文案。因此按优先级严格兑现，并排除上传/制作类入口。
  const EXCLUDE = /上传|制作|新增|导入|预览|下载/
  const PRIORITY = [/^发简历$/, /^发送简历$/, /发简历/, /发送简历/, /投简历/]
  const nodes = Array.from(
    document.querySelectorAll('a,button,[role="button"],li,span,div'),
  )
  for (const re of PRIORITY) {
    for (const el of nodes) {
      const t = textOf(el)
      if (!t || t.length > 10) continue
      if (EXCLUDE.test(t)) continue
      if (!re.test(t)) continue
      // 取最内层，避免命中包含该文案的容器
      if (Array.from(el.children).some((c) => re.test(textOf(c)))) continue
      if (!isRoughlyVisible(el)) continue
      return el as HTMLElement
    }
  }
  return null
}

export async function sendResume(): Promise<{ ok: boolean; error?: string }> {
  const btn = findResumeButton()
  if (!btn) {
    return {
      ok: false,
      error: '未找到可见的发简历按钮（选择器与文案兑现均未命中，请跑「选择器自检」）',
    }
  }
  safeClick(btn)

  // 等确认框（最多 ~3s）
  let confirmed = false
  const confirmDeadline = Date.now() + 3000
  while (Date.now() < confirmDeadline) {
    if (hasResumeSuccessSignal()) {
      return { ok: true }
    }
    if (hasResumeErrorSignal()) {
      return { ok: false, error: '发简历出现错误提示' }
    }
    const sure = findVisibleConfirm()
    if (sure) {
      safeClick(sure)
      confirmed = true
      break
    }
    await sleep(200)
  }

  // 确认后或无确认框时再等成功态 ~2s
  const successDeadline = Date.now() + 2000
  while (Date.now() < successDeadline) {
    if (hasResumeSuccessSignal()) return { ok: true }
    if (hasResumeErrorSignal()) {
      return { ok: false, error: '发简历出现错误提示' }
    }
    // 确认框消失且无错误：弱成功（仅当曾点确认）
    if (confirmed && !isConfirmVisible()) {
      await sleep(300)
      if (hasResumeErrorSignal()) {
        return { ok: false, error: '发简历出现错误提示' }
      }
      if (hasResumeSuccessSignal() || !isConfirmVisible()) {
        // 确认框消失且无错误：视为成功
        return { ok: true }
      }
    }
    await sleep(200)
  }

  if (hasResumeSuccessSignal()) return { ok: true }

  // fail-closed
  if (!confirmed) {
    return {
      ok: false,
      error: '发简历超时：未出现确认框且无成功态（fail-closed）',
    }
  }
  return {
    ok: false,
    error: '发简历超时：已点确认但无成功态（fail-closed）',
  }
}

/**
 * 从会话行文本解析（适配「姓名 公司|职位」+ 第二行预览）
 * 例：肖女士 优途 | 猎头顾问 / 对不超，看了你的简历…
 */
function parseSessionLine(raw: string): {
  title: string
  company?: string
  preview?: string
} {
  const lines = (raw || '')
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const head = lines[0] || ''
  const preview = lines.slice(1).join(' ').slice(0, 80) || undefined
  // 去掉时间 13:30
  const noTime = head.replace(/\b\d{1,2}:\d{2}\b/g, '').trim()
  // 「公司 | 职位」
  if (noTime.includes('|')) {
    const parts = noTime.split('|').map((p) => p.trim())
    const left = parts[0] || ''
    const right = parts.slice(1).join(' | ')
    // left 可能是「肖女士 优途」→ 取最后一段当公司
    const leftBits = left.split(/\s+/).filter(Boolean)
    const company =
      leftBits.length >= 2 ? leftBits[leftBits.length - 1] : leftBits[0]
    const person = leftBits.length >= 2 ? leftBits.slice(0, -1).join('') : ''
    const title = [person, right].filter(Boolean).join(' ').slice(0, 60) || noTime
    return { title, company, preview }
  }
  return {
    title: noTime.slice(0, 60) || '会话',
    company: undefined,
    preview,
  }
}

function sessionRowElements(): HTMLElement[] {
  const raw = allEl(document, SELECTORS.chatSessionItem) as HTMLElement[]
  // 过滤掉过小/导航噪声
  const filtered = raw.filter((el) => {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
    if (t.length < 4 || t.length > 200) return false
    if (/搜索|筛选|AI筛选|全部|未读|新招呼|更多/.test(t) && t.length < 20) {
      return false
    }
    return true
  })
  // 去重：去掉被包含的子节点
  const set = new Set(filtered)
  return filtered.filter((el) => {
    let p = el.parentElement
    while (p) {
      if (set.has(p as HTMLElement)) return false
      p = p.parentElement
    }
    return true
  })
}

/**
 * 读会话行的未读徐标。
 *
 * 宁可漏报不可误报：误报会把无新消息的会话排到队列前面，
 * 白耗点击次数并增加风控暴露。因此要求徐标可见，且纯数字文本才计数。
 */
function readUnreadBadge(row: Element): { unread: boolean; count?: number } {
  const nodes = allEl(row, SELECTORS.chatSessionUnread)
  for (const n of nodes) {
    if (!isRoughlyVisible(n)) continue
    const t = textOf(n)
    if (/^\d{1,3}$/.test(t)) {
      const c = Number(t)
      if (c > 0) return { unread: true, count: c }
      continue
    }
    // 无数字的红点：只有尺寸很小且无文本时才当未读
    if (!t) {
      const r = (n as HTMLElement).getBoundingClientRect()
      if (r.width <= 16 && r.height <= 16) return { unread: true }
    }
  }
  return { unread: false }
}

export function listChatSessions(): ChatSessionItem[] {
  let items = sessionRowElements()
  // 启发式回退：左侧栏可点击行
  if (items.length < 3) {
    const heur = Array.from(
      document.querySelectorAll(
        '[class*="chat"] li, [class*="friend"] li, [class*="user-list"] li, [class*="conversation"] li',
      ),
    ) as HTMLElement[]
    items = heur.filter((el) => {
      const t = (el.innerText || '').trim()
      return t.length >= 6 && t.length < 180
    })
  }

  const out: ChatSessionItem[] = []
  const seen = new Set<string>()

  for (let i = 0; i < items.length; i++) {
    const el = items[i]
    const titleEl = firstEl(el, SELECTORS.chatSessionTitle)
    const companyEl = firstEl(el, SELECTORS.chatSessionCompany)
    const previewEl = firstEl(el, SELECTORS.chatSessionPreview)
    let title = textOf(titleEl)
    let company = textOf(companyEl) || undefined
    let preview = textOf(previewEl) || undefined

    if (!title || title.length < 2) {
      const parsed = parseSessionLine(el.innerText || el.textContent || '')
      title = parsed.title
      company = company || parsed.company
      preview = preview || parsed.preview
    } else if (!company && title.includes('|')) {
      const parsed = parseSessionLine(`${title}\n${preview || ''}`)
      company = parsed.company
      title = parsed.title || title
    }

    if (!title || title.length < 1) continue
    // 整行 blob 写入 preview 便于匹配
    const blob = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const key =
      (el.getAttribute('data-id') ||
        el.getAttribute('data-uid') ||
        el.getAttribute('data-geek') ||
        '') +
      '|' +
      title +
      '|' +
      (company || '') +
      '|' +
      i
    if (seen.has(key)) continue
    seen.add(key)
    const unread = readUnreadBadge(el)
    out.push({
      key,
      title: title.slice(0, 80),
      company,
      preview: preview || blob,
      unread: unread.unread,
      unreadCount: unread.count,
    })
  }
  return out
}

export function openChatSession(
  match: ChatSessionMatch,
): { ok: true; score: number; key: string } | { ok: false; error: string } {
  const sessions = listChatSessions()
  if (!sessions.length) {
    return {
      ok: false,
      error: '会话列表为空，无法定位目标会话（S1）。请确认在消息页且列表已加载。',
    }
  }
  // 增强 match：把 company 也塞进 jobTitle 空时的 blob 搜索
  const enriched: ChatSessionMatch = {
    ...match,
    jobTitle: match.jobTitle || match.company,
  }
  const picked = pickBestSession(enriched, sessions)
  if (!picked.ok) {
    return {
      ok: false,
      error: `会话匹配不足（bestScore=${picked.bestScore}，候选${sessions.length}条，S1）`,
    }
  }

  const items = sessionRowElements()
  let target: Element | null = null
  for (let i = 0; i < items.length; i++) {
    const el = items[i]
    const blob = (el.innerText || '').replace(/\s+/g, ' ')
    if (
      blob.includes(picked.session.title.slice(0, 8)) ||
      (picked.session.company && blob.includes(picked.session.company.slice(0, 4)))
    ) {
      // 再确认分数：该行文本
      target = el
      if (picked.session.key.endsWith(`|${i}`)) break
    }
  }
  if (!target) {
    const idx = Number(picked.session.key.split('|').pop())
    if (Number.isFinite(idx) && items[idx]) target = items[idx]
  }
  if (!target) {
    return { ok: false, error: '找到匹配会话但无法定位 DOM 节点（S1）' }
  }

  safeClick(target as HTMLElement)
  return { ok: true, score: picked.score, key: picked.session.key }
}

/** 当前右侧已打开会话时，从页头/标题估公司职位（用于「处理当前」） */
export function readActiveChatContext(): { title?: string; company?: string; blob: string } {
  const header = firstEl(
    document,
    [
      '.chat-conversation .base-info',
      '.chat-main .base-info',
      '.conversation-header',
      '[class*="chat-main"] [class*="name"]',
      '.chat-message .name',
    ].join(','),
  )
  const blob = textOf(header) || document.title || ''
  const parsed = parseSessionLine(blob)
  return { title: parsed.title, company: parsed.company, blob }
}

/**
 * 页面鉴权态：login / captcha / ok / unknown
 *
 * 保守策略：
 * - 页脚常有「扫码登录/请登录」，禁止用 body 全文匹配判登录
 * - 详情页 URL 是 /job_detail/ 不是 /web/geek，曾被误判 auth_lost
 * - 有业务 DOM（列表卡/详情/立即沟通/聊天）→ ok；unknown 不 pause
 */
export function detectAuthState(): 'ok' | 'login' | 'captcha' | 'unknown' {
  const href = location.href || ''

  // —— 强业务信号：一律视为已登录会话可用 ——
  if (allEl(document, SELECTORS.jobCard).length > 0) return 'ok'
  if (firstEl(document, SELECTORS.chatInput)) return 'ok'
  if (allEl(document, SELECTORS.chatSessionItem).length > 0) return 'ok'
  // 职位详情（临时 tab 常见）：有详情根 / 描述 / 立即沟通
  if (
    /job_detail\//i.test(href) ||
    firstEl(document, SELECTORS.jobDetailRoot) ||
    firstEl(document, SELECTORS.jobDesc) ||
    firstEl(document, SELECTORS.openChatBtn)
  ) {
    return 'ok'
  }
  // 求职 geek 区（列表加载中）
  if (
    /zhipin\.com\/web\/geek/i.test(href) &&
    !/\/web\/user\/|\/login|passport/i.test(href)
  ) {
    return 'unknown'
  }

  // —— 仅明确登录 URL 判 login ——
  if (
    /\/wapi\/.*login|\/login|\/sign\/|passport\.|\/web\/user\/login/i.test(href) &&
    !/job_detail|\/web\/geek|\/web\/chat/i.test(href)
  ) {
    return 'login'
  }

  // —— 验证码：必须可见控件，禁止仅正文 ——
  const captchaEl = firstEl(document, SELECTORS.captchaRoot) as HTMLElement | null
  if (captchaEl && isRoughlyVisible(captchaEl)) {
    return 'captcha'
  }

  // —— 登录表单：仅非业务 URL + 可见密码框 ——
  if (!/job_detail|\/web\/geek|\/web\/chat/i.test(href)) {
    const pwd = firstEl(document, 'input[type="password"]') as HTMLElement | null
    if (pwd && isRoughlyVisible(pwd)) {
      return 'login'
    }
  }

  return 'unknown'
}

export function chatPageUrl(): string {
  return BOSS_URLS.chat
}
