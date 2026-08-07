import type { ContentCommand } from '../shared/messages'
import { execCommand } from './bridge'
import { refreshMessageOverlay } from './message-overlay'

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.channel !== 'content/exec') return false
  const command = msg.command as ContentCommand
  execCommand(command)
    .then((result) => sendResponse({ type: 'content/exec', result }))
    .catch((e) =>
      sendResponse({
        type: 'content/exec',
        result: { ok: false, error: e instanceof Error ? e.message : String(e) },
      }),
    )
  return true
})

// 消息页：挂载「消息助手」浮层
refreshMessageOverlay()
// SPA 路由切换时再尝试
let lastHref = location.href
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href
    refreshMessageOverlay()
  }
}, 1500)

console.info('[boss-job-assistant] content script ready', location.href)