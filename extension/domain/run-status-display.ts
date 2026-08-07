import type { RunState } from '../shared/types'

/** 运行 phase → 中文（未知 phase 原样返回） */
const PHASE_ZH: Record<string, string> = {
  idle: '空闲',
  ensure_tab: '准备工作标签',
  sync_profile: '同步简历',
  select_source: '定位职位列表',
  next_job: '读取职位卡片',
  extract_jd: '抽取职位详情',
  llm_match: 'LLM 匹配评分',
  rate_limit_wait: '限速等待',
  open_chat: '开聊',
  follow_up: '跟进会话',
  paused: '已暂停',
}

export function phaseLabelZh(phase: string | undefined | null): string {
  if (!phase) return '—'
  return PHASE_ZH[phase] || phase
}

export type AnomalyView = {
  kind: string
  reason?: string
  until: number
  needsHuman?: boolean
} | null

/** 侧栏运行态主文案（纯函数，便于单测） */
export function formatRunStatusText(input: {
  state: RunState
  anomaly?: AnomalyView
  notice?: string | null
  now?: number
}): string {
  const now = input.now ?? Date.now()
  const r = input.state
  const lines: string[] = []

  if (r.status === 'idle') {
    lines.push('空闲')
  } else if (r.status === 'paused') {
    lines.push(`已暂停：${r.reason || '未知原因'}`)
  } else {
    const phase = phaseLabelZh(r.phase)
    const list = r.cursor?.listLabel ? ` · ${r.cursor.listLabel}` : ''
    const sess =
      r.sessionOpened != null || r.sessionReplies != null
        ? ` · 本轮开聊${r.sessionOpened ?? 0}/回复${r.sessionReplies ?? 0}`
        : ''
    lines.push(`运行中 · ${phase}${list}${sess}`)
  }

  if (input.notice) {
    lines.push(input.notice)
  }

  const a = input.anomaly
  if (a && a.until > now) {
    const mins = Math.max(1, Math.ceil((a.until - now) / 60000))
    const human = a.needsHuman ? '（需人工处理验证/登录）' : ''
    lines.push(
      `冷却中：${a.reason || a.kind} · 约 ${mins} 分钟${human}`,
    )
  }

  return lines.join('\n')
}

/** 开始前确认文案 */
export function formatStartConfirmText(input: {
  listLabel: string
  listUrl?: string
}): string {
  const label = (input.listLabel || '当前职位列表').trim()
  const tip =
    /推荐/.test(label)
      ? '\n提示：当前像「推荐」列表；若要投指定分类，请先在 BOSS 点到该分类标签。'
      : '\n请保持该列表页标签不要关闭。'
  return `将从「${label}」锁定开聊，确认开始？${tip}`
}

/** 分类/列表问题引导（notice 增强） */
export function enhanceListFailureNotice(notice: string | null | undefined): string | null {
  if (!notice) return null
  if (notice.includes('分类')) {
    return `${notice}。请回到目标分类标签后再点开始。`
  }
  if (notice.includes('列表暂无')) {
    return `${notice}。可滚动加载更多，或换筛选/城市后重试。`
  }
  return notice
}
