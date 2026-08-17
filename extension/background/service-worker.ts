import type { RequestMessage } from '../shared/messages'
import { maskKvForExport } from '../shared/export-mask'
import * as kv from '../data/kv'
import { listRecentEvents } from '../data/repos/events'
import { listAllJobs } from '../data/repos/jobs'
import { listAllEvents } from '../data/repos/events'
import { listLastNDays } from '../data/repos/daily-stats'
import { listAllThreads } from '../data/repos/chat-threads'
import { summaryTodayAndWeek } from '../data/analytics'
import {
  ensureAlarms,
  startRun,
  stopRun,
  onAlarm,
  handleWorkerTabRemoved,
  getStatus,
  manualSyncProfile,
  execOnWorker,
  ensureWorkerTab,
  runMessageAssist,
  processCurrentChatSession,
  openBossChatTab,
  openHandoffThread,
  previewRunList,
} from './scheduler'
import { resetErrorThreads, listHandoffThreads, resolveHandoff } from '../data/repos/chat-threads'
import {
  clearAllFailedOpenForRetry,
  clearFailedOpenForRetry,
} from '../data/repos/jobs'
import { ensureHostPermissionForLlm, testLlmConnection } from './llm-client'
import {
  importExistingThreads,
  startAll as startMsgAssistAll,
  stopAll as stopMsgAssistAll,
  getProgress as getMsgAssistProgress,
  onAlarm as onMsgAssistAlarm,
} from './message-assist-loop'

function wireSidePanelClick() {
  // 无 popup 时：点击工具栏图标 → 打开侧栏（须每次 SW 启动都设置）
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined)
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms()
  wireSidePanelClick()
})

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms()
  wireSidePanelClick()
})

// 开发者模式「重新加载」后 SW 会重启；不依赖 onInstalled 也能打开侧栏
wireSidePanelClick()

// 兜底：部分 Chrome 版本 setPanelBehavior 不可靠时，显式 open
chrome.action.onClicked.addListener((tab) => {
  const winId = tab.windowId
  if (winId == null) return
  chrome.sidePanel.open({ windowId: winId }).catch(() => undefined)
})

chrome.alarms.onAlarm.addListener((alarm) => {
  void onAlarm(alarm.name)
  void onMsgAssistAlarm(alarm.name)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleWorkerTabRemoved(tabId)
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  void handleMessage(msg as RequestMessage)
    .then(sendResponse)
    .catch((e) =>
      sendResponse({
        type: 'error',
        error: e instanceof Error ? e.message : String(e),
      }),
    )
  return true
})

async function handleMessage(msg: RequestMessage) {
  switch (msg.type) {
    case 'run/start': {
      const r = await startRun()
      if (!r.ok) return { type: 'error', error: r.error }
      return { type: 'ok' }
    }
    case 'run/preview': {
      const r = await previewRunList()
      if (!r.ok) return { type: 'run/preview', ok: false as const, error: r.error }
      return {
        type: 'run/preview',
        ok: true as const,
        listLabel: r.listLabel,
        listUrl: r.listUrl,
        tabId: r.tabId,
      }
    }
    case 'run/stop': {
      await stopRun(msg.reason || '用户停止')
      return { type: 'ok' }
    }
    case 'run/status': {
      const s = await getStatus()
      return {
        type: 'run/status',
        state: s.state,
        todayOpened: s.todayOpened,
        todayReplies: s.todayReplies,
        anomaly: s.anomaly,
        notice: s.notice,
      }
    }
    case 'kv/get': {
      const { policy, llm, profile, messageAssist } = await kv.getAllKv()
      return { type: 'kv/get', policy, llm, profile, messageAssist }
    }
    case 'kv/set': {
      // 允许显式写入空对象字段；用 hasOwn 而非 truthy，避免误判
      if (Object.prototype.hasOwnProperty.call(msg, 'policy') && msg.policy) {
        await kv.setPolicy(msg.policy)
      }
      if (Object.prototype.hasOwnProperty.call(msg, 'llm') && msg.llm) {
        await kv.setLlmConfig(msg.llm)
      }
      if (Object.prototype.hasOwnProperty.call(msg, 'profile') && msg.profile) {
        await kv.setProfile(msg.profile)
      }
      if (
        Object.prototype.hasOwnProperty.call(msg, 'messageAssist') &&
        msg.messageAssist
      ) {
        await kv.setMessageAssist(msg.messageAssist)
      }
      return { type: 'ok' }
    }
    case 'messageAssist/get': {
      const config = await kv.getMessageAssist()
      return { type: 'messageAssist/get', config }
    }
    case 'messageAssist/set': {
      await kv.setMessageAssist(msg.config)
      return { type: 'ok' }
    }
    case 'messageAssist/run': {
      const r = await runMessageAssist({
        limit: msg.limit,
        resetErrors: msg.resetErrors,
      })
      return {
        type: 'messageAssist/run',
        ok: r.ok,
        processed: r.processed,
        results: r.results,
        error: r.error,
      }
    }
    case 'messageAssist/runCurrent': {
      const r = await processCurrentChatSession()
      return {
        type: 'messageAssist/runCurrent',
        ok: r.ok,
        result: r.result,
        error: r.error,
      }
    }
    case 'messageAssist/openChat': {
      const tabId = await openBossChatTab()
      return { type: 'messageAssist/openChat', tabId }
    }
    case 'messageAssist/resetErrors': {
      const count = await resetErrorThreads()
      return { type: 'messageAssist/resetErrors', count }
    }
    case 'threads/import': {
      const r = await importExistingThreads()
      if (!r.ok) return { type: 'error', error: r.error }
      return {
        type: 'threads/import',
        imported: r.imported,
        updated: r.updated,
        skipped: r.skipped,
        scanned: r.scanned,
      }
    }
    case 'messageAssist/runAll': {
      const r = await startMsgAssistAll()
      if (!r.ok) return { type: 'error', error: r.error }
      return { type: 'ok' }
    }
    case 'messageAssist/stopAll': {
      await stopMsgAssistAll()
      return { type: 'ok' }
    }
    case 'messageAssist/progress': {
      const p = await getMsgAssistProgress()
      return { type: 'messageAssist/progress', ...p }
    }
    case 'handoff/list': {
      const rows = await listHandoffThreads()
      return {
        type: 'handoff/list',
        items: rows.map((t) => ({
          id: t.id,
          company: t.company,
          jobTitle: t.jobTitle,
          reason: t.lastError,
          lastActionAt: t.lastActionAt,
        })),
      }
    }
    case 'handoff/resolve': {
      const ok = await resolveHandoff(msg.threadId, msg.next ?? 'done')
      return { type: 'handoff/resolve', ok }
    }
    case 'handoff/open': {
      const r = await openHandoffThread(msg.threadId)
      if (!r.ok) return { type: 'handoff/open', ok: false, error: r.error }
      return {
        type: 'handoff/open',
        ok: true,
        located: r.located,
        tabId: r.tabId,
      }
    }
    case 'jobs/retryFailedOpen': {
      if (msg.jobId) {
        const ok = await clearFailedOpenForRetry(msg.jobId)
        return { type: 'jobs/retryFailedOpen', requeued: ok ? 1 : 0 }
      }
      const n = await clearAllFailedOpenForRetry()
      return { type: 'jobs/retryFailedOpen', requeued: n }
    }
    case 'profile/sync': {
      const profile = await manualSyncProfile()
      return { type: 'profile/sync', profile }
    }
    case 'llm/test': {
      // 侧栏经消息面调用；requestIfMissing 依赖扩展页用户手势传递（尽力而为）
      const llm = msg.llm ?? (await kv.getLlmConfig())
      const perm = await ensureHostPermissionForLlm(llm.baseUrl, {
        requestIfMissing: true,
      })
      if (!perm.granted) {
        return {
          type: 'error',
          error: [
            `未授予访问 ${perm.originPattern}`,
            `当前已授予：${perm.grantedOrigins.join(', ') || '（无）'}`,
          ].join('\n'),
        }
      }
      const result = await testLlmConnection(llm)
      return {
        type: 'llm/test',
        ok: true as const,
        url: result.url,
        reply: result.reply,
        latencyMs: result.latencyMs,
        originPattern: result.originPattern ?? perm.originPattern,
      }
    }
    case 'analytics/summary': {
      const summary = await summaryTodayAndWeek()
      return { type: 'analytics/summary', summary }
    }
    case 'events/list': {
      const events = await listRecentEvents(msg.limit ?? 50)
      return { type: 'events/list', events }
    }
    case 'export/all': {
      const payload = {
        exportedAt: Date.now(),
        jobs: await listAllJobs(),
        events: await listAllEvents(),
        daily_stats: await listLastNDays(365),
        threads: await listAllThreads(),
        kv: maskKvForExport(await kv.getAllKv()),
      }
      return { type: 'export/all', payload }
    }
    case 'content/exec': {
      const tabId = msg.tabId ?? (await ensureWorkerTab())
      const result = await execOnWorker(msg.command, tabId)
      return { type: 'content/exec', result }
    }
    default:
      return { type: 'error', error: '未知消息类型' }
  }
}

ensureAlarms()