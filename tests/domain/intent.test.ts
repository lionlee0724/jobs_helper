import { describe, expect, it } from 'vitest'
import {
  classifyIntent,
  handlingFor,
  handoffReason,
} from '../../extension/domain/intent'

describe('classifyIntent', () => {
  it('detects resume request', () => {
    expect(classifyIntent('方便发一份简历吗')).toBe('resume_request')
    expect(classifyIntent('请发下简历看看')).toBe('resume_request')
  })

  it('detects reject', () => {
    expect(classifyIntent('抱歉，不太合适')).toBe('reject')
    expect(classifyIntent('岗位已招满')).toBe('reject')
  })

  it('defaults to other for generic chatter', () => {
    expect(classifyIntent('你好，看到你的简历了')).toBe('other')
    expect(classifyIntent('我们公司做智能制造的')).toBe('other')
  })
})

describe('classifyIntent — 高危意图', () => {
  it('索要联系方式', () => {
    // 约电话本身即属联系方式/日程范畴，按保守侧归类
    expect(classifyIntent('你好，方便电话沟通吗？')).toBe('contact_request')
    expect(classifyIntent('留个微信吧')).toBe('contact_request')
    expect(classifyIntent('手机号多少')).toBe('contact_request')
  })

  it('薪资谈判', () => {
    expect(classifyIntent('你的期望薪资是多少')).toBe('salary_question')
    expect(classifyIntent('这个待遇能接受吗')).toBe('salary_question')
  })

  it('面试邀约', () => {
    expect(classifyIntent('明天下午方便面试吗')).toBe('interview_invite')
    expect(classifyIntent('约个时间聊聊')).toBe('interview_invite')
  })

  it('混合句归到更保守的一侧', () => {
    // 同时提到薪资与简历 → 必须是薪资（需人工），不能降级成发简历
    expect(classifyIntent('期望薪资多少？方便发下简历')).toBe('salary_question')
  })
})

describe('classifyIntent — 可自动回答的事实类', () => {
  it('到岗时间', () => {
    expect(classifyIntent('什么时候可以到岗')).toBe('availability_question')
    expect(classifyIntent('目前在职吗')).toBe('availability_question')
  })

  it('工作地点', () => {
    expect(classifyIntent('上班地点在光谷，可以接受吗')).toBe('location_question')
  })
})

describe('handlingFor — 分级处置', () => {
  it('高危意图一律转人工', () => {
    expect(handlingFor('salary_question')).toBe('handoff')
    expect(handlingFor('interview_invite')).toBe('handoff')
    expect(handlingFor('contact_request')).toBe('handoff')
  })

  it('发简历走平台动作', () => {
    expect(handlingFor('resume_request')).toBe('auto_action')
  })

  it('事实类可自动回复', () => {
    expect(handlingFor('availability_question')).toBe('auto')
    expect(handlingFor('location_question')).toBe('auto')
    expect(handlingFor('other')).toBe('auto')
  })

  it('拒绝与系统消息不回', () => {
    expect(handlingFor('reject')).toBe('ignore')
    expect(handlingFor('system')).toBe('ignore')
  })
})

describe('handoffReason', () => {
  it('给出可读原因', () => {
    expect(handoffReason('salary_question')).toContain('薪资')
    expect(handoffReason('contact_request')).toContain('隐私')
  })
})
