import type { Profile } from '../../../shared/types'
import { BOSS_URLS } from '../../../shared/boss-urls'
import { SELECTORS, firstEl, textOf, safeClick } from './selectors'

const NOISE_PATTERNS = [
  /真实头像可以吸引更多招聘者[\s\S]{0,80}/g,
  /请使用白底或蓝底证件照[\s\S]{0,80}/g,
  /手机号.*打码[\s\S]{0,40}/g,
  /点击编辑/g,
  /立即沟通/g,
  /在线简历/g,
  /附件简历/g,
  /预览简历/g,
  /下载简历/g,
  /隐私设置/g,
  /谁看过我/g,
  /牛人专区/g,
  /推荐牛人/g,
]

/** 抓取简历页尽量完整的纯文本（不做 LLM） */
export function scrapeResumePage(): {
  rawText: string
  href: string
  charCount: number
} {
  // 尝试展开「查看更多」类按钮
  clickExpanders()

  const chunks: string[] = []

  // 1) 专用简历根节点（多候选，取最长）
  const roots = collectRoots()
  for (const root of roots) {
    chunks.push(textOf(root))
  }

  // 2) 分节标题附近内容
  const sectionText = collectByHeadings()
  if (sectionText) chunks.push(sectionText)

  // 3) 主内容区兜底
  const main =
    document.querySelector('main') ||
    document.querySelector('#main') ||
    document.querySelector('.main-content')
  if (main) chunks.push(textOf(main))

  // 合并去重噪声
  let raw = chunks
    .sort((a, b) => b.length - a.length)[0] || textOf(document.body)
  raw = cleanNoise(raw)
  raw = raw.replace(/\s{2,}/g, ' ').trim()

  // 若仍过短，拼上 body 全文再清一次
  if (raw.length < 400) {
    raw = cleanNoise(textOf(document.body))
  }

  // 上限：给 LLM 留空间
  raw = raw.slice(0, 40000)

  return {
    rawText: raw,
    href: location.href,
    charCount: raw.length,
  }
}

/** @deprecated 兼容旧路径：无 LLM 时的粗摘要 */
export function extractProfile(): Profile {
  const { rawText } = scrapeResumePage()
  return {
    syncedAt: Date.now(),
    summary: rawText.slice(0, 800) || '（未能解析）',
    skills: [],
    rawText,
    analyzedByLlm: false,
  }
}

function collectRoots(): Element[] {
  const sel = [
    SELECTORS.profileRoot,
    '.resume-detail-wrap',
    '.resume-box',
    '.geek-resume-card',
    '.resume-content',
    '.user-resume-detail',
    '[class*="resume-detail"]',
    '[class*="ResumeDetail"]',
    '.all-content',
  ].join(',')
  return Array.from(document.querySelectorAll(sel))
}

function collectByHeadings(): string {
  const keywords = [
    '个人优势',
    '工作经历',
    '项目经验',
    '教育经历',
    '资格证书',
    '志愿者',
    '专业技能',
    '期望职位',
    '求职期望',
    '工作经历',
    '项目',
    '教育',
  ]
  const parts: string[] = []
  const all = Array.from(document.querySelectorAll('h1,h2,h3,h4,div,section,li'))
  for (const el of all) {
    const t = (el.textContent || '').trim()
    if (t.length < 2 || t.length > 40) continue
    if (!keywords.some((k) => t.includes(k))) continue
    // 取父级大块
    const block = el.closest('section, .resume-section, .item, li, div') || el.parentElement
    if (block) {
      const bt = textOf(block)
      if (bt.length > 20 && bt.length < 8000) parts.push(bt)
    }
  }
  return parts.join('\n\n')
}

function clickExpanders() {
  const labels = ['展开', '查看更多', '显示全部', '更多']
  const buttons = Array.from(
    document.querySelectorAll('a, button, span, div'),
  ) as HTMLElement[]
  for (const b of buttons) {
    const t = (b.textContent || '').trim()
    if (t.length > 12) continue
    if (!labels.some((l) => t.includes(l))) continue
    safeClick(b)
  }
}

function cleanNoise(text: string): string {
  let t = text
  for (const p of NOISE_PATTERNS) {
    t = t.replace(p, ' ')
  }
  // 连续重复短句压缩
  t = t.replace(/(.{8,40})\1{2,}/g, '$1')
  return t
}

export function profilePageUrl(): string {
  return BOSS_URLS.resume
}

void firstEl

// SELECTORS 在 scrape 中通过 profileRoot 字符串已展开使用