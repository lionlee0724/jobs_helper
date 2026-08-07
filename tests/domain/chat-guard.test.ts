import { describe, it, expect } from 'vitest'
import { screenOutgoingText } from '../../extension/domain/chat-llm'

/**
 * 出站护栏是隐私外泄的最后一道防线：
 * 即使提示词已禁止，模型仍可能复述简历里的联系方式。
 */
describe('screenOutgoingText', () => {
  it('拦截手机号', () => {
    const r = screenOutgoingText('我的电话是13812345678，方便联系')
    expect(r.ok).toBe(false)
    expect(r.violation).toBe('手机号')
  })

  it('拦截邮箱', () => {
    const r = screenOutgoingText('可以发我邮箱 abc.def@gmail.com')
    expect(r.ok).toBe(false)
    expect(r.violation).toBe('邮箱')
  })

  it('拦截微信号', () => {
    const r = screenOutgoingText('微信：zhangsan_2020')
    expect(r.ok).toBe(false)
  })

  it('放行正常回复', () => {
    expect(screenOutgoingText('您好，我目前在职，一个月内可以到岗。').ok).toBe(true)
    expect(screenOutgoingText('主要负责项目交付与团队管理。').ok).toBe(true)
  })

  it('薪资数字不被误拦', () => {
    expect(screenOutgoingText('我的期望是 20K 左右').ok).toBe(true)
  })
})
