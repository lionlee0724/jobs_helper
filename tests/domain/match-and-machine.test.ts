import { describe, expect, it } from 'vitest'
import { parseMatchResult } from '../../extension/domain/match-llm'
import { parseChatReply } from '../../extension/domain/chat-llm'
import { reduceMachine, initialMachine } from '../../extension/domain/run-state-machine'

describe('parseMatchResult', () => {
  it('parses plain json', () => {
    const r = parseMatchResult('{"suitable":true,"reasons":["技能匹配"],"confidence":0.8}')
    expect(r.suitable).toBe(true)
    expect(r.reasons[0]).toBe('技能匹配')
  })

  it('parses fenced-ish content', () => {
    const r = parseMatchResult('结果如下\n{"suitable":false,"reasons":["城市不符"]}\n')
    expect(r.suitable).toBe(false)
  })
})

describe('parseChatReply', () => {
  it('parses text field', () => {
    expect(parseChatReply('{"text":"好的，我方便面试"}')).toBe('好的，我方便面试')
  })
})

describe('reduceMachine', () => {
  it('starts and pauses', () => {
    let s = initialMachine()
    s = reduceMachine(s, { type: 'START', workerTabId: 3 })
    expect(s.status).toBe('running')
    expect(s.workerTabId).toBe(3)
    s = reduceMachine(s, { type: 'PAUSE', reason: 'cap' })
    expect(s.status).toBe('paused')
    expect(s.reason).toBe('cap')
  })
})