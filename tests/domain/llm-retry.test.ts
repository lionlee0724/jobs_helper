import { describe, expect, it } from 'vitest'
import { isRetryableLlmError } from '../../extension/background/llm-client'

describe('isRetryableLlmError', () => {
  it('超时可重试', () => {
    expect(isRetryableLlmError(new Error('LLM 请求超时（45000ms）'))).toBe(true)
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(isRetryableLlmError(abort)).toBe(true)
  })

  it('网络 Failed to fetch 可重试', () => {
    expect(isRetryableLlmError(new Error('Failed to fetch'))).toBe(true)
    expect(
      isRetryableLlmError(new Error('无法连接 LLM（https://x/v1）\n原始错误：NetworkError')),
    ).toBe(true)
  })

  it('HTTP 429 / 5xx 可重试', () => {
    expect(isRetryableLlmError(new Error('LLM HTTP 429 @ https://x: rate limit'))).toBe(true)
    expect(isRetryableLlmError(new Error('LLM HTTP 503 @ https://x: busy'))).toBe(true)
    expect(isRetryableLlmError(new Error('LLM HTTP 500 @ https://x: oops'))).toBe(true)
  })

  it('HTTP 4xx 鉴权/配置不可重试', () => {
    expect(isRetryableLlmError(new Error('LLM HTTP 401 @ https://x: unauthorized'))).toBe(false)
    expect(isRetryableLlmError(new Error('LLM HTTP 403 @ https://x: forbidden'))).toBe(false)
    expect(isRetryableLlmError(new Error('LLM HTTP 400 @ https://x: bad request'))).toBe(false)
  })

  it('配置不完整 / 解析失败不可重试', () => {
    expect(isRetryableLlmError(new Error('LLM 配置不完整（baseUrl / apiKey / model）'))).toBe(
      false,
    )
    expect(isRetryableLlmError(new Error('匹配结果无法解析为 JSON'))).toBe(false)
    expect(isRetryableLlmError(new Error('LLM 返回空 content（请检查 model 名是否正确）'))).toBe(
      false,
    )
  })
})
