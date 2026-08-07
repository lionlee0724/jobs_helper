/** 侧栏 / 报告页：解析 chrome.runtime.sendMessage 回包（纯函数，可单测） */

export type LooseResponse = {
  type?: string
  error?: string
  [k: string]: unknown
}

/**
 * 后台无响应或 type=error 时抛错；成功回包原样返回。
 * 用于按钮动作（开始/停止/保存）—— 避免「已启动」假成功。
 */
export function requireOkResponse<T extends LooseResponse>(
  res: T | null | undefined,
  fallback = '扩展后台无响应（请到 chrome://extensions 重新加载本扩展）',
): T {
  if (res == null || typeof res !== 'object') {
    throw new Error(fallback)
  }
  if (res.type === 'error') {
    throw new Error(typeof res.error === 'string' && res.error ? res.error : '操作失败')
  }
  return res
}

/** 仅检查 null/undefined，不把业务 error 当异常（供 status 轮询） */
export function requireMessageResponse<T extends LooseResponse>(
  res: T | null | undefined,
  fallback = '扩展后台无响应（请到 chrome://extensions 重新加载本扩展）',
): T {
  if (res == null || typeof res !== 'object') {
    throw new Error(fallback)
  }
  return res
}
