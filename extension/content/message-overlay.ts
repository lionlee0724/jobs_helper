/** 消息页浮层：用户切到聊天页时的可见控制 */

const ROOT_ID = 'boss-msg-assist-root'

function isChatPage(): boolean {
  return /\/web\/geek\/chat|\/chat/i.test(location.href)
}

export function mountMessageOverlay() {
  if (!isChatPage()) {
    unmountMessageOverlay()
    return
  }
  if (document.getElementById(ROOT_ID)) return

  const root = document.createElement('div')
  root.id = ROOT_ID
  root.innerHTML = `
    <style>
      #${ROOT_ID} {
        all: initial;
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483646;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
        font-size: 13px;
        color: #ffffff;
        -webkit-font-smoothing: antialiased;
      }
      #${ROOT_ID} .panel {
        width: 290px;
        background: rgba(28, 28, 30, 0.88);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 16px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.2);
        overflow: hidden;
      }
      #${ROOT_ID} .hd {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.05);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        cursor: move;
        user-select: none;
      }
      #${ROOT_ID} .hd b {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      #${ROOT_ID} .hd button {
        all: unset;
        cursor: pointer;
        color: #8e8e93;
        padding: 2px 6px;
        font-size: 14px;
        border-radius: 4px;
        transition: color 0.15s ease;
      }
      #${ROOT_ID} .hd button:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
      }
      #${ROOT_ID} .bd { padding: 12px 14px 14px; }
      #${ROOT_ID} .status {
        font-size: 12px;
        color: #a1a1a6;
        margin-bottom: 10px;
        min-height: 2.6em;
        white-space: pre-wrap;
        line-height: 1.45;
        background: rgba(0, 0, 0, 0.25);
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      #${ROOT_ID} .row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      #${ROOT_ID} .row button {
        all: unset;
        box-sizing: border-box;
        background: linear-gradient(135deg, #0a84ff 0%, #0066d6 100%);
        color: #ffffff;
        border-radius: 8px;
        padding: 7px 11px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: -0.01em;
        box-shadow: 0 2px 6px rgba(10, 132, 255, 0.25);
        transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
        text-align: center;
      }
      #${ROOT_ID} .row button:hover {
        filter: brightness(1.08);
        transform: translateY(-1px);
      }
      #${ROOT_ID} .row button:active {
        transform: scale(0.97);
      }
      #${ROOT_ID} .row button.sec {
        background: rgba(120, 120, 128, 0.24);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #ffffff;
        box-shadow: none;
      }
      #${ROOT_ID} .row button.sec:hover {
        background: rgba(120, 120, 128, 0.36);
      }
      #${ROOT_ID} .row button:disabled {
        opacity: .45;
        cursor: not-allowed;
        transform: none !important;
      }
      #${ROOT_ID} .log {
        max-height: 120px;
        overflow-y: auto;
        font-size: 11px;
        color: #8e8e93;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 8px;
        margin-top: 4px;
      }
      #${ROOT_ID} .log div {
        padding: 3px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      }
      #${ROOT_ID}.min .bd { display: none; }
    </style>
    <div class="panel">
      <div class="hd">
        <b>消息助手</b>
        <span>
          <button type="button" data-act="min" title="折叠">–</button>
          <button type="button" data-act="hide" title="隐藏">×</button>
        </span>
      </div>
      <div class="bd">
        <div class="status" data-el="status">「处理一轮」= 库内可跟进队列；「处理当前会话」= 只跟进右侧已打开会话（不扫列表）。不会静默自动跑。</div>
        <div class="row">
          <button type="button" data-act="run">处理一轮</button>
          <button type="button" data-act="run-current" class="sec">处理当前会话</button>
        </div>
        <div class="row">
          <button type="button" data-act="reset" class="sec">重置错误会话</button>
          <button type="button" data-act="refresh" class="sec">刷新说明</button>
        </div>
        <div class="log" data-el="log"></div>
      </div>
    </div>
  `
  document.documentElement.appendChild(root)

  const statusEl = root.querySelector('[data-el="status"]') as HTMLElement
  const logEl = root.querySelector('[data-el="log"]') as HTMLElement
  let busy = false

  function log(line: string) {
    const div = document.createElement('div')
    div.textContent = `${new Date().toLocaleTimeString()} · ${line}`
    logEl.prepend(div)
    while (logEl.childElementCount > 12) logEl.lastChild?.remove()
  }

  root.querySelector('[data-act="min"]')?.addEventListener('click', () => {
    root.classList.toggle('min')
  })
  root.querySelector('[data-act="hide"]')?.addEventListener('click', () => {
    root.remove()
  })
  root.querySelector('[data-act="refresh"]')?.addEventListener('click', () => {
    statusEl.textContent =
      '处理一轮：库内队列点开会话 → 读消息 → 发简历/LLM。处理当前：只跟右侧已开会话（可落库 source=current_ui）。定位失败 3 次才标错。'
  })

  function setBusy(on: boolean) {
    busy = on
    const acts = ['run', 'run-current', 'reset']
    for (const a of acts) {
      const b = root.querySelector(`[data-act="${a}"]`) as HTMLButtonElement | null
      if (b) b.disabled = on
    }
  }

  root.querySelector('[data-act="reset"]')?.addEventListener('click', () => {
    if (busy) return
    setBusy(true)
    statusEl.textContent = '正在重置错误会话…'
    chrome.runtime.sendMessage({ type: 'messageAssist/resetErrors' }, (res) => {
      setBusy(false)
      if (chrome.runtime.lastError) {
        statusEl.textContent = chrome.runtime.lastError.message || '失败'
        return
      }
      if (res?.type === 'messageAssist/resetErrors') {
        statusEl.textContent = `已重置 ${res.count} 个错误会话，可再点「处理一轮」`
        log(`reset ${res.count}`)
      } else {
        statusEl.textContent = res?.error || '重置失败'
      }
    })
  })

  root.querySelector('[data-act="run"]')?.addEventListener('click', () => {
    if (busy) return
    setBusy(true)
    statusEl.textContent = '处理一轮中…请勿关闭消息页'
    chrome.runtime.sendMessage(
      { type: 'messageAssist/run', limit: 5 },
      (res) => {
        setBusy(false)
        if (chrome.runtime.lastError) {
          statusEl.textContent = chrome.runtime.lastError.message || '通信失败'
          return
        }
        if (res?.type !== 'messageAssist/run') {
          statusEl.textContent = res?.error || '未知响应'
          return
        }
        if (!res.ok) {
          statusEl.textContent = res.error || '处理失败'
          log(res.error || 'fail')
          return
        }
        statusEl.textContent = `本轮处理 ${res.processed} 条`
        for (const r of res.results || []) {
          const who = [r.company, r.jobTitle].filter(Boolean).join('·') || r.threadId
          log(`${r.action} · ${who}${r.detail ? ' · ' + r.detail.slice(0, 40) : ''}`)
        }
        if (!res.results?.length) log(res.error || '无结果')
      },
    )
  })

  root.querySelector('[data-act="run-current"]')?.addEventListener('click', () => {
    if (busy) return
    setBusy(true)
    statusEl.textContent = '处理当前会话…请保持右侧会话已打开'
    chrome.runtime.sendMessage({ type: 'messageAssist/runCurrent' }, (res) => {
      setBusy(false)
      if (chrome.runtime.lastError) {
        statusEl.textContent = chrome.runtime.lastError.message || '通信失败'
        log('fail · ' + (chrome.runtime.lastError.message || '通信失败'))
        return
      }
      if (res?.type !== 'messageAssist/runCurrent') {
        const err = res?.error || '未知响应'
        statusEl.textContent = err
        log('fail · ' + err)
        return
      }
      if (!res.ok || !res.result) {
        const err = res.error || '处理当前会话失败'
        statusEl.textContent = err
        log('fail · ' + err)
        return
      }
      const r = res.result
      const who = [r.company, r.jobTitle].filter(Boolean).join('·') || r.threadId
      statusEl.textContent = `当前会话：${r.action} · ${who}${r.detail ? ' · ' + r.detail.slice(0, 40) : ''}`
      log(`current · ${r.action} · ${who}${r.detail ? ' · ' + r.detail.slice(0, 40) : ''}`)
    })
  })
}

export function unmountMessageOverlay() {
  document.getElementById(ROOT_ID)?.remove()
}

export function refreshMessageOverlay() {
  if (isChatPage()) mountMessageOverlay()
  else unmountMessageOverlay()
}
