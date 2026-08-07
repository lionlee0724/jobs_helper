import type { LlmConfig } from '../shared/types'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ChatCompletionOpts = {
  temperature?: number
  timeoutMs?: number
  /** 尽量要求 JSON（部分兼容端支持） */
  jsonMode?: boolean
  /**
   * 为 true 时：权限不足直接失败，不假装已授权。
   * 侧栏「测试 LLM」应设 true（有用户手势可 request）。
   * SW 后台循环可设 false：依赖已授予的 host_permissions。
   */
  requireGrantedPermission?: boolean
  /**
   * 失败后额外重试次数（默认 0：消息助手 / 测连通行为不变）。
   * 职位匹配可传 2 → 共 3 次尝试。
   */
  retries?: number
  /** 重试退避基毫秒；第 n 次失败后等待 base * 2^n（默认 1000 → 约 1s / 2s） */
  retryBackoffMs?: number
}

/** 可恢复错误：超时 / 网络 / HTTP 429 / 5xx → 可重试；4xx 鉴权配置等 → 否 */
export function isRetryableLlmError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  const name = err instanceof Error ? err.name : ''
  if (name === 'AbortError') return true
  if (/请求超时|timeout|AbortError/i.test(msg)) return true
  if (/Failed to fetch|NetworkError|无法连接 LLM|Network request failed/i.test(msg)) {
    return true
  }
  // HTTP 429 / 5xx（含我们抛出的 `LLM HTTP 503 @ …`）
  const http = msg.match(/LLM HTTP (\d{3})\b/i) || msg.match(/\bHTTP\s+(\d{3})\b/i)
  if (http) {
    const code = Number(http[1])
    if (code === 429 || (code >= 500 && code <= 599)) return true
    return false
  }
  return false
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 规范化 OpenAI 兼容 chat/completions 地址。
 *
 * 必须处理人工粘贴的常见畸形：
 * - 尾部斜杠：`https://host/` + `/v1` → `https://host//v1`，服务端会当作不同路径返回 404
 * - 路径中间重复斜杠
 * - 只填主机名（绝大多数兼容端实际在 /v1 下）
 *
 * 双斜杠导致的 404 很难自查：错误里的 URL 肘一眼看上去是对的。
 */
export function resolveChatCompletionsUrl(baseUrl: string): string {
  let base = baseUrl.trim()
  if (!base) throw new Error('Base URL 为空')
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`
  }

  // 只折叠协议之后的重复斜杠，不动 `https://`
  base = base.replace(/^(https?:\/\/)(.*)$/i, (_m, scheme: string, rest: string) => {
    return scheme + rest.replace(/\/{2,}/g, '/')
  })
  base = base.replace(/\/+$/, '')

  if (/\/chat\/completions$/i.test(base)) return base
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`

  // 无路径（仅主机名）：按 OpenAI 兼容惯例补 /v1
  try {
    const u = new URL(base)
    if (u.pathname === '' || u.pathname === '/') {
      return `${u.origin}/v1/chat/completions`
    }
  } catch {
    /* 解析失败则走下方通用拼接 */
  }

  return `${base}/chat/completions`
}

export function originPatternFromBaseUrl(baseUrl: string): string {
  const url = new URL(resolveChatCompletionsUrl(baseUrl))
  return `${url.protocol}//${url.host}/*`
}

function listGrantedOrigins(): string[] {
  // getAll 在部分测试环境可能不存在
  return []
}

async function getGrantedOrigins(): Promise<string[]> {
  try {
    const all = await chrome.permissions.getAll()
    return all.origins ?? []
  } catch {
    return listGrantedOrigins()
  }
}

/** 判断已授予的 origins 是否覆盖目标 */
export function originsCoverTarget(granted: string[], originPattern: string): boolean {
  if (granted.includes('<all_urls>') || granted.includes('*://*/*')) return true
  if (granted.includes(originPattern)) return true

  let target: URL
  try {
    // originPattern like https://host/*
    target = new URL(originPattern.replace(/\/\*$/, '/'))
  } catch {
    return false
  }

  for (const g of granted) {
    if (g === 'https://*/*' && target.protocol === 'https:') return true
    if (g === 'http://*/*' && target.protocol === 'http:') return true
    if (g === '*://*/*') return true
    // https://*.example.com/* 之类：简单包含 host 匹配
    if (g.endsWith('/*')) {
      try {
        const gu = new URL(g.replace(/\/\*$/, '/'))
        if (gu.protocol === target.protocol && gu.hostname === target.hostname) return true
        if (gu.hostname.startsWith('*.')) {
          const root = gu.hostname.slice(2)
          if (
            gu.protocol === target.protocol &&
            (target.hostname === root || target.hostname.endsWith(`.${root}`))
          ) {
            return true
          }
        }
      } catch {
        // ignore bad pattern
      }
    }
  }
  return false
}

/**
 * 确保扩展有权访问该 API 域名。
 * - host_permissions 含 <all_urls> 时通常已覆盖
 * - 侧栏有用户手势时可尝试 request 具体 origin（若 manifest 未声明 optional 会失败，再回退检查）
 * - SW 无手势：只检查，不假装成功
 */
export async function ensureHostPermissionForLlm(
  baseUrl: string,
  opts?: { requestIfMissing?: boolean },
): Promise<{
  originPattern: string
  granted: boolean
  grantedOrigins: string[]
  triedRequest: boolean
}> {
  const originPattern = originPatternFromBaseUrl(baseUrl)
  const requestIfMissing = opts?.requestIfMissing ?? true

  let grantedOrigins = await getGrantedOrigins()
  if (originsCoverTarget(grantedOrigins, originPattern)) {
    return { originPattern, granted: true, grantedOrigins, triedRequest: false }
  }

  try {
    const has = await chrome.permissions.contains({ origins: [originPattern] })
    if (has) {
      return { originPattern, granted: true, grantedOrigins, triedRequest: false }
    }
    const hasAll = await chrome.permissions.contains({ origins: ['<all_urls>'] })
    if (hasAll) {
      return { originPattern, granted: true, grantedOrigins, triedRequest: false }
    }
    const hasHttps = await chrome.permissions.contains({ origins: ['https://*/*'] })
    if (hasHttps && originPattern.startsWith('https:')) {
      return { originPattern, granted: true, grantedOrigins, triedRequest: false }
    }
  } catch {
    // ignore
  }

  if (!requestIfMissing) {
    return { originPattern, granted: false, grantedOrigins, triedRequest: false }
  }

  try {
    // 无 optional 声明时 request 会抛错；有 <all_urls> 时上面已返回
    const ok = await chrome.permissions.request({ origins: [originPattern] })
    grantedOrigins = await getGrantedOrigins()
    const granted =
      ok ||
      originsCoverTarget(grantedOrigins, originPattern) ||
      (await chrome.permissions.contains({ origins: [originPattern] }).catch(() => false))
    return { originPattern, granted: Boolean(granted), grantedOrigins, triedRequest: true }
  } catch {
    grantedOrigins = await getGrantedOrigins()
    const granted = originsCoverTarget(grantedOrigins, originPattern)
    return { originPattern, granted, grantedOrigins, triedRequest: true }
  }
}

function permissionHelp(originPattern: string, grantedOrigins: string[]): string {
  const got = grantedOrigins.length ? grantedOrigins.join(', ') : '（无）'
  return [
    `目标权限：${originPattern}`,
    `当前已授予：${got}`,
    `请到 chrome://extensions →「BOSS 求职副驾驶」→ 详细信息 →「网站访问」选「所有网站」`,
    `然后点扩展「重新加载」，再回侧栏测一次`,
  ].join('\n')
}

/**
 * fetch 的 header 值必须是 ISO-8859-1（ByteString）。
 * 复制粘贴 API Key 时常带入零宽字符、全角符号、中文说明等，会触发：
 * "String contains non ISO-8859-1 code point"
 */
/** 去掉复制粘贴常见污染：BOM/零宽/NBSP（用 \u 转义，避免源文件本身带不可见字符） */
function stripInvisible(s: string): string {
  return s
    .replace(/﻿/g, '')
    .replace(/[​-‍⁠]/g, '')
    .replace(/ /g, ' ')
}

export function sanitizeHeaderValue(label: string, raw: string): string {
  let v = stripInvisible((raw || '').normalize('NFKC')).trim()
  // 去掉首尾成对引号（中英文）
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
  ]
  for (const [a, b] of pairs) {
    if (v.startsWith(a) && v.endsWith(b) && v.length >= 2) {
      v = v.slice(1, -1).trim()
      break
    }
  }
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i)
    // HTTP header ByteString: 0–255；控制字符除 tab 外也不安全
    if (code > 255 || (code < 32 && code !== 9)) {
      throw new Error(
        [
          `${label} 含非法字符（HTTP 请求头只能是 ASCII/Latin-1）。`,
          `位置约第 ${i + 1} 个字符，码点 U+${code.toString(16).toUpperCase().padStart(4, '0')}。`,
          '常见原因：API Key 从网页复制时带了中文、全角符号、不可见字符。',
          '请重新手输或纯文本粘贴 API Key（不要带「密钥：」等中文前缀），保存后再试。',
        ].join('\n'),
      )
    }
  }
  return v
}

/** 单次 chat/completions（不含 retries 循环）；jsonMode 回退也走本函数 */
async function chatCompletionOnce(
  llm: LlmConfig,
  messages: ChatMessage[],
  opts?: ChatCompletionOpts,
): Promise<string> {
  if (!llm.baseUrl?.trim() || !llm.apiKey?.trim() || !llm.model?.trim()) {
    throw new Error('LLM 配置不完整（baseUrl / apiKey / model）')
  }

  // 先清洗，避免 fetch 抛难懂的 ISO-8859-1 错误
  const apiKey = sanitizeHeaderValue('API Key', llm.apiKey)
  const model = sanitizeHeaderValue('Model', llm.model)
  // baseUrl 进 URL，不进自定义中文 header；仍做轻量清洗
  const baseUrlClean = stripInvisible(llm.baseUrl.normalize('NFKC')).trim()

  const url = resolveChatCompletionsUrl(baseUrlClean)
  const requireGranted = opts?.requireGrantedPermission ?? false
  const perm = await ensureHostPermissionForLlm(baseUrlClean, {
    // 后台默认不弹权限窗；测试路径会先在侧栏 request
    requestIfMissing: requireGranted,
  })

  if (requireGranted && !perm.granted) {
    throw new Error(
      `未获得访问权限，无法请求 LLM。\n${permissionHelp(perm.originPattern, perm.grantedOrigins)}`,
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 45_000)

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts?.temperature ?? 0.3,
  }
  if (opts?.jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  try {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/non ISO-8859-1|ByteString|code point/i.test(msg)) {
        throw new Error(
          [
            'LLM 请求头含非 ASCII 字符（多为 API Key 复制污染）。',
            '请清空 API Key 后重新粘贴纯英文/数字密钥，保存 LLM 再试。',
            `原始错误：${msg}`,
          ].join('\n'),
        )
      }
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        const grantedOrigins = await getGrantedOrigins()
        const covered = originsCoverTarget(grantedOrigins, perm.originPattern)

        // 权限已覆盖时，继续拿权限说事只会误导排查方向。
        // fetch 抛 TypeError 说明失败发生在**收到 HTTP 响应之前**，
        // 常见原因按发生频率：代理/VPN > DNS > 证书 > 拦截插件。
        if (covered) {
          throw new Error(
            [
              `无法连接 LLM（${url}）`,
              `原始错误：${msg}`,
              '权限已覆盖该域名，因此**不是权限问题**。请先排查：',
              '1) 代理/VPN：若开了 Clash/Surge 等 TUN 或 fake-IP 模式，域名会被解析到 198.18.x.x / 10.x 类假地址，仅浏览器主请求能走通。请把该域名加入代理规则，或改用直连可达的地址',
              '2) DNS：确认解析出的是真实公网 IP',
              '3) 证书：自签证书在浏览器里可以点「继续访问」绕过，但扩展 fetch 不会，必须是受信任证书',
              '4) 广告/隐私类扩展拦截了 chrome-extension 发起的请求',
              '快速判别：在侧栏点「测试 LLM」会同时跑 Service Worker 与侧栏两条路径，对比结果即可定位。',
            ].join('\n'),
          )
        }

        throw new Error(
          [
            `无法连接 LLM（${url}）`,
            `原始错误：${msg}`,
            '扩展无该站访问权（无权限时 Chrome 会把跨域 POST 变成 Failed to fetch，而不是 HTTP 状态码）。',
            permissionHelp(perm.originPattern, grantedOrigins),
          ].join('\n'),
        )
      }
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`LLM 请求超时（${opts?.timeoutMs ?? 45_000}ms）`)
      }
      throw e
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      if (
        opts?.jsonMode &&
        (res.status === 400 || res.status === 422) &&
        /response_format|json_object|unknown/i.test(errBody)
      ) {
        // 兼容端不认 json_object：同一次逻辑内降级，不计入 retries
        return chatCompletionOnce(llm, messages, { ...opts, jsonMode: false })
      }
      throw new Error(`LLM HTTP ${res.status} @ ${url}: ${errBody.slice(0, 400)}`)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>
      error?: { message?: string }
    }
    if (data.error?.message) {
      throw new Error(`LLM 错误: ${data.error.message}`)
    }
    const content = data.choices?.[0]?.message?.content
    if (content == null || String(content).trim() === '') {
      throw new Error('LLM 返回空 content（请检查 model 名是否正确）')
    }
    return String(content)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * OpenAI 兼容 chat/completions。
 * 默认 retries=0；可恢复错误时按 retries / retryBackoffMs 退避重试，耗尽后抛最后一次错误。
 */
export async function chatCompletion(
  llm: LlmConfig,
  messages: ChatMessage[],
  opts?: ChatCompletionOpts,
): Promise<string> {
  const extraRetries = Math.max(0, Math.floor(opts?.retries ?? 0))
  const backoffBase = Math.max(0, opts?.retryBackoffMs ?? 1000)
  let lastErr: unknown
  for (let attempt = 0; attempt <= extraRetries; attempt++) {
    try {
      return await chatCompletionOnce(llm, messages, opts)
    } catch (e) {
      lastErr = e
      const canRetry = attempt < extraRetries && isRetryableLlmError(e)
      if (!canRetry) throw e
      const delay = backoffBase * Math.pow(2, attempt)
      if (delay > 0) await sleepMs(delay)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** 连通性自检：短请求，返回模型原文片段 */
export async function testLlmConnection(llm: LlmConfig): Promise<{
  ok: true
  url: string
  reply: string
  latencyMs: number
  originPattern: string
  grantedOrigins: string[]
}> {
  const url = resolveChatCompletionsUrl(llm.baseUrl)
  // 测试路径：允许 request，且权限不足必须失败
  const perm = await ensureHostPermissionForLlm(llm.baseUrl, { requestIfMissing: true })
  if (!perm.granted) {
    throw new Error(
      `测试中止：未授予 ${perm.originPattern}\n${permissionHelp(perm.originPattern, perm.grantedOrigins)}`,
    )
  }

  const t0 = Date.now()
  const reply = await chatCompletion(
    llm,
    [
      {
        role: 'user',
        content: '请只回复一个词：OK。不要解释。',
      },
    ],
    { temperature: 0, timeoutMs: 30_000, jsonMode: false, requireGrantedPermission: true },
  )
  return {
    ok: true,
    url,
    reply: reply.trim().slice(0, 200),
    latencyMs: Date.now() - t0,
    originPattern: perm.originPattern,
    grantedOrigins: perm.grantedOrigins,
  }
}