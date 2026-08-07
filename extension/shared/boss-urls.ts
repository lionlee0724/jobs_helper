/** 与 DOM 无关的 BOSS URL 常量 — SW / content 可共用 */

export const BOSS_URLS = {
  recommend: 'https://www.zhipin.com/web/geek/job-recommend',
  /** 注意：站点可能是 /job 或 /jobs，比较时必须用规范化，禁止 startsWith('/web/geek/job') 误伤 /jobs */
  expect1: 'https://www.zhipin.com/web/geek/jobs',
  expect2: 'https://www.zhipin.com/web/geek/jobs?expectIndex=1',
  resume: 'https://www.zhipin.com/web/geek/resume',
  chat: 'https://www.zhipin.com/web/geek/chat',
} as const

export function urlForSource(source: 'current' | 'recommend' | 'expect1' | 'expect2'): string {
  switch (source) {
    case 'current':
      // current 必须用 cursor.listUrl；此回退仅兜底
      return BOSS_URLS.recommend
    case 'recommend':
      return BOSS_URLS.recommend
    case 'expect1':
      return BOSS_URLS.expect1
    case 'expect2':
      return BOSS_URLS.expect2
  }
}

/** 规范化 URL：origin+pathname+search，去掉 hash、尾斜杠 */
export function normalizePageUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '') || '/'
    return `${u.origin}${path}${u.search}`
  } catch {
    return (url || '').split('#')[0].replace(/\/+$/, '')
  }
}

export function isSamePageUrl(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  return normalizePageUrl(a) === normalizePageUrl(b)
}

/**
 * 是否职位列表页（推荐 / 期望 / 自定义分类）。
 * 禁止用 startsWith('/web/geek/job') 判断：会把 /jobs 和 /job 互相误判。
 */
export function isJobListUrl(url?: string | null): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    if (!/(^|\.)zhipin\.com$/i.test(u.hostname) && !/(^|\.)bosszhipin\.com$/i.test(u.hostname)) {
      return false
    }
    const p = u.pathname.replace(/\/+$/, '') || '/'
    if (p.includes('job-recommend')) return true
    if (p === '/web/geek/job' || p === '/web/geek/jobs') return true
    // 其它 geek 列表变体，排除详情/聊天/简历
    if (p.startsWith('/web/geek/') && /job/i.test(p)) {
      if (/job_detail|\/chat|\/resume|\/recommend\/boss/i.test(p)) return false
      return true
    }
    return false
  } catch {
    return false
  }
}

export function isChatUrl(url?: string | null): boolean {
  return Boolean(url && /\/web\/geek\/chat/i.test(url))
}

export function isResumeUrl(url?: string | null): boolean {
  return Boolean(url && /\/web\/geek\/resume/i.test(url))
}

export function isJobDetailUrl(url?: string | null): boolean {
  return Boolean(url && /job_detail\//i.test(url || ''))
}

/** 从 URL 粗识别来源标签（展示/落库用） */
export function detectSourceFromUrl(url: string): 'current' | 'recommend' | 'expect1' | 'expect2' {
  const u = url || ''
  if (u.includes('job-recommend')) return 'recommend'
  if (u.includes('expectIndex=1') || u.includes('expect=1')) return 'expect2'
  if (isJobListUrl(u)) return 'current'
  return 'current'
}