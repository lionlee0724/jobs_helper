import { describe, expect, it } from 'vitest'
import {
  enhanceListFailureNotice,
  formatRunStatusText,
  formatStartConfirmText,
  phaseLabelZh,
} from '../../extension/domain/run-status-display'

describe('phaseLabelZh', () => {
  it('maps known phases', () => {
    expect(phaseLabelZh('llm_match')).toBe('LLM 匹配评分')
    expect(phaseLabelZh('open_chat')).toBe('开聊')
    expect(phaseLabelZh('next_job')).toBe('读取职位卡片')
  })
  it('passthrough unknown', () => {
    expect(phaseLabelZh('custom_x')).toBe('custom_x')
  })
})

describe('formatRunStatusText', () => {
  it('idle', () => {
    expect(formatRunStatusText({ state: { status: 'idle' } })).toBe('空闲')
  })

  it('running with chinese phase and list', () => {
    const t = formatRunStatusText({
      state: {
        status: 'running',
        phase: 'llm_match',
        workerTabId: 3,
        cursor: { sourceIndex: 0, preferFollowUp: false, listLabel: '项目经理' },
        startedAt: 1,
        sessionOpened: 1,
        sessionReplies: 0,
      },
    })
    expect(t).toContain('运行中')
    expect(t).toContain('LLM 匹配评分')
    expect(t).toContain('项目经理')
    expect(t).toContain('本轮开聊1')
  })

  it('shows empty-list notice and anomaly cooldown', () => {
    const now = 1_000_000
    const t = formatRunStatusText({
      state: { status: 'idle' },
      notice: '列表暂无新职位，将按闹钟稍后重试',
      anomaly: {
        kind: 'captcha',
        reason: '验证码',
        until: now + 10 * 60_000,
        needsHuman: true,
      },
      now,
    })
    expect(t).toContain('列表暂无新职位')
    expect(t).toContain('冷却中')
    expect(t).toContain('验证码')
    expect(t).toMatch(/约 \d+ 分钟/)
  })
})

describe('formatStartConfirmText / enhanceListFailureNotice', () => {
  it('confirm includes label', () => {
    const s = formatStartConfirmText({ listLabel: '项目经理/主管' })
    expect(s).toContain('项目经理/主管')
    expect(s).toMatch(/确认开始/)
  })
  it('recommend tip', () => {
    expect(formatStartConfirmText({ listLabel: '推荐职位' })).toMatch(/推荐/)
  })
  it('enhance category notice', () => {
    expect(enhanceListFailureNotice('分类锁定失败')).toMatch(/回到目标分类/)
  })
  it('enhance empty list', () => {
    expect(enhanceListFailureNotice('列表暂无新职位')).toMatch(/滚动/)
  })
})
