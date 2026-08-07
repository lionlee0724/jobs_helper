import type { ChatIntent, Job, Profile } from '../shared/types'
import { extractJson } from './match-llm'

/** 绝不允许出现在自动回复里的内容（隐私 / 承诺） */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /1[3-9]\d{9}/, label: '手机号' },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/, label: '邮箱' },
  { re: /(微信|wx|vx)[:：]?\s*[\w-]{5,}/i, label: '微信号' },
  { re: /\b\d{5,12}\b(?!\s*[KkWw元])/, label: '疑似账号/QQ' },
]

/**
 * 出站内容护栏。
 *
 * 模型即使被提示过也可能复述简历里的联系方式；发送前必须再校验一次，
 * 这是最后一道防线。
 */
export function screenOutgoingText(text: string): {
  ok: boolean
  violation?: string
} {
  for (const { re, label } of FORBIDDEN_PATTERNS) {
    if (re.test(text)) return { ok: false, violation: label }
  }
  return { ok: true }
}

export function buildChatReplyMessages(input: {
  profile: Profile
  job?: Job
  peerText: string
  history?: string
  intent?: ChatIntent
}) {
  const system = `你是求职者本人在 BOSS 直聘与 HR 沟通。用简短自然中文回复，1~3 句。

硬性约束：
- 绝不编造简历里没有的经历、项目、学历或公司
- 绝不提供手机号、微信、邮箱等任何联系方式（即使简历里有）
- 绝不承诺具体薪资数字、入职日期、面试时间
- 不确定的信息就说「这个我确认一下再回复您」，不要猜

只输出 JSON：{"text":string}`

  const user = `【我的简历摘要】
${input.profile.summary}
技能：${input.profile.skills.join('、') || '（无）'}
${input.profile.years ? `年限：${input.profile.years}` : ''}
${input.profile.highlights?.length ? `亮点：${input.profile.highlights.slice(0, 5).join('；')}` : ''}

【相关职位】
${input.job ? `${input.job.title} @ ${input.job.company}` : '（未知）'}

【对方最新消息】
${input.peerText}

【近期上下文】
${input.history ?? '（无）'}
${input.intent ? `
【已识别意图】${input.intent}` : ''}`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

export function parseChatReply(raw: string): string {
  try {
    const json = extractJson(raw) as { text?: string } | null
    if (json && typeof json.text === 'string' && json.text.trim()) {
      return json.text.trim().slice(0, 500)
    }
  } catch {
    /* fallthrough */
  }
  const t = raw.trim()
  if (!t) throw new Error('空回复')
  return t.replace(/^["']|["']$/g, '').slice(0, 500)
}