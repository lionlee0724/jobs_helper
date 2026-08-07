import type { ChatIntent } from '../shared/types'

/**
 * HR 消息意图分类。
 *
 * 分级依据：不同意图的**回答代价**不同。
 * - 模板类（到岗时间、工作地点）答错成本低，可自动回
 * - 承诺类（薪资、面试时间）一旦答错会形成事实承诺，必须人工
 * - 联系方式涉及隐私外泄，永不自动回
 *
 * 顺序敏感：先判高危意图，再判普通意图，避免「薪资能接受吗，方便发下简历」
 * 这类混合句被降级成发简历。
 */

const SYSTEM_PATTERNS = [
  /系统消息/,
  /以上是打招呼内容/,
  /对方已读/,
  /消息已发出/,
  /该职位已停止招聘/,
]

const REJECT_PATTERNS = [
  /不合适/,
  /不太合适/,
  /已招满/,
  /招满了/,
  /岗位关闭/,
  /停止招聘/,
  /暂不考虑/,
  /不太匹配/,
  /不需要了/,
  /婉拒/,
  /已找到/,
  /另请高明/,
]

/** 索要联系方式：隐私高危，永不自动回 */
const CONTACT_PATTERNS = [
  /(电话|手机|微信|wx|vx|qq|邮箱|联系方式)\s*(号|号码)?\s*(多少|是多少|发我|给我|方便|留一个|留个|加一下|加个)/,
  /(加|换)\s*(个)?\s*(微信|电话|联系方式)/,
  /方便.*(电话|微信|联系)/,
  /留个?(电话|手机|微信|联系方式)/,
  /您的(电话|手机|微信|邮箱)/,
]

/** 薪资谈判：形成事实承诺，必须人工 */
const SALARY_PATTERNS = [
  /期望薪资|薪资期望|薪资要求|期望多少|要求多少/,
  /目前薪资|current\s*salary/i,
  // 两种语序都要覆盖：「能接受这个待遇吗」与「这个待遇能接受吗」
  /(能|可以)?接受.{0,8}(薪资|价格|待遇|package)/i,
  /(薪资|价格|待遇|package).{0,8}(能|可以)?接受/i,
  /(薪资|待遇|package).*(多少|范围|区间)/i,
  /报个价|开多少/,
]

/** 面试邀约：涉及时间承诺，必须人工确认 */
const INTERVIEW_PATTERNS = [
  /面试/,
  /约个时间|约时间|安排.*时间/,
  /(明天|后天|下周|周[一二三四五六日天]).*(方便|有空|可以)/,
  /来公司|到公司.*(聊|谈)/,
  /视频(沟通|面|聊)/,
]

const RESUME_PATTERNS = [
  /发(一[下份])?简历/,
  /发下简历/,
  /发个简历/,
  /简历发(我|一下|过来|来)/,
  /把简历/,
  /附件简历/,
  /上传简历/,
  /投(一[下份])?简历/,
  /发份简历/,
  /看下你的简历|看看你的简历/,
  /resume/i,
  /cv\b/i,
]

/** 到岗时间：事实性问题，可模板回答 */
const AVAILABILITY_PATTERNS = [
  /什么时候(可以)?(到岗|入职|上班)/,
  /多久能?(到岗|入职)/,
  /(离职|在职)了吗|目前在职/,
  /到岗时间/,
  /最快.*(入职|到岗)/,
]

/** 工作地点确认：事实性问题，可模板回答 */
const LOCATION_PATTERNS = [
  /(能|可以|方便)?接受.*(地点|地址|上班地|通勤|出差|外派)/,
  /住(在)?哪|现在在哪个?(城市|区)/,
  /上班地点.*(可以|方便|接受)吗/,
  /离.*(远|近)吗/,
]

export function classifyIntent(text: string): ChatIntent {
  const t = (text || '').trim()
  if (!t) return 'system'

  if (SYSTEM_PATTERNS.some((p) => p.test(t))) return 'system'
  if (REJECT_PATTERNS.some((p) => p.test(t))) return 'reject'

  // —— 高危优先：混合句必须归到更保守的一侧 ——
  if (CONTACT_PATTERNS.some((p) => p.test(t))) return 'contact_request'
  if (SALARY_PATTERNS.some((p) => p.test(t))) return 'salary_question'
  if (INTERVIEW_PATTERNS.some((p) => p.test(t))) return 'interview_invite'

  if (RESUME_PATTERNS.some((p) => p.test(t))) return 'resume_request'
  if (AVAILABILITY_PATTERNS.some((p) => p.test(t))) return 'availability_question'
  if (LOCATION_PATTERNS.some((p) => p.test(t))) return 'location_question'

  return 'other'
}

export type IntentHandling = 'auto' | 'auto_action' | 'handoff' | 'ignore'

/**
 * 意图 → 处置方式。
 *
 * handoff 表示挂起并通知用户，绝不由模型代答。
 */
export function handlingFor(intent: ChatIntent): IntentHandling {
  switch (intent) {
    case 'resume_request':
      return 'auto_action'
    case 'availability_question':
    case 'location_question':
      return 'auto'
    case 'salary_question':
    case 'interview_invite':
    case 'contact_request':
      return 'handoff'
    case 'reject':
    case 'system':
      return 'ignore'
    case 'other':
      return 'auto'
  }
}

/** 需要人工处理的原因说明（展示给用户） */
export function handoffReason(intent: ChatIntent): string {
  switch (intent) {
    case 'salary_question':
      return '涉及薪资谈判，自动回复可能形成不利承诺'
    case 'interview_invite':
      return '涉及面试时间承诺，需你确认日程'
    case 'contact_request':
      return '对方索要联系方式，出于隐私不自动提供'
    default:
      return '需人工确认'
  }
}
