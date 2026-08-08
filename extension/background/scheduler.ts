/**
 * Scheduler 门面：start/stop/tick/alarms + 对外 re-export。
 * 具体业务拆到 tab-runtime / open-chat-flow / follow-up-flow / run-guards / profile-sync。
 */
import {
  canStart,
  isFollowUpInJobRunEnabled,
} from '../domain/policy'
import {
  isWithinActiveWindow,
  msUntilActiveWindow,
} from '../domain/risk'
import * as kv from '../data/kv'
import { appendEvent, listRecentEvents } from '../data/repos/events'
import { getDaily } from '../data/repos/daily-stats'
import { pruneIfNeeded } from '../data/retention'
import { summaryTodayAndWeek } from '../data/analytics'
import {
  activeGeneration,
  bumpGeneration,
  inFlight,
  isStillRunning,
  lastTickLogAt,
  patchCursor,
  resetMatchLlmFailures,
  setActiveGeneration,
  setInFlight,
  setLastTickLogAt,
  stopRun,
} from './run-context'
import { detectAndPauseIfAuthLost } from './run-guards'
import {
  ensureOnListPage,
  isRecommendish,
  resolveCurrentListTab,
  verifyListCategoryOrRestore,
} from './tab-runtime'
import { runOpenChatBatch } from './open-chat-flow'
import { runFollowUpBatch } from './follow-up-flow'

// ── 对外 re-export（service-worker / message-assist-loop 稳定入口） ──
export { stopRun } from './run-context'
export { ensureWorkerTab, execOnWorker } from './tab-runtime'
export { manualSyncProfile } from './profile-sync'
export {
  runMessageAssist,
  processCurrentChatSession,
  scanChatSessions,
  openBossChatTab,
  openHandoffThread,
  type MessageAssistItemResult,
  type MessageAssistResult,
  type MessageAssistCurrentResult,
} from './follow-up-flow'

const ALARM_TICK = 'boss-job-tick'

export function ensureAlarms() {
  chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 })
}

export async function onAlarm(name: string) {
  if (name !== ALARM_TICK) return
  await tick()
}

/**
 * 开始前预览将锁定的列表（不改 runState）。
 * 供侧栏确认「将从【xx】开聊」。
 */
export async function previewRunList(): Promise<
  | { ok: true; listLabel: string; listUrl: string; tabId: number }
  | { ok: false; error: string }
> {
  const policy = await kv.getPolicy()
  const guard = canStart(policy)
  if (!guard.ok) return { ok: false, error: guard.reason }
  const anomaly = await kv.getAnomaly()
  if (anomaly && Date.now() < anomaly.until) {
    const mins = Math.ceil((anomaly.until - Date.now()) / 60000)
    return {
      ok: false,
      error:
        `冷却中（${anomaly.reason || anomaly.kind}），约 ${mins} 分钟。` +
        (anomaly.needsHuman ? '请先完成验证/登录。' : ''),
    }
  }
  const win = isWithinActiveWindow(policy)
  if (!win.ok) {
    return { ok: false, error: win.reason }
  }
  const pinned = await resolveCurrentListTab()
  if (!pinned.ok) return { ok: false, error: pinned.error }
  return {
    ok: true,
    listLabel: pinned.listLabel,
    listUrl: pinned.listUrl,
    tabId: pinned.tabId,
  }
}

export async function startRun(): Promise<{ ok: true } | { ok: false; error: string }> {
  const policy = await kv.getPolicy()
  const guard = canStart(policy)
  if (!guard.ok) return { ok: false, error: guard.reason }

  // 退避闸门：刚撞验证码/限流就立刻重启是最容易加重处罚的操作
  const anomaly = await kv.getAnomaly()
  if (anomaly && Date.now() < anomaly.until) {
    const mins = Math.ceil((anomaly.until - Date.now()) / 60000)
    return {
      ok: false,
      error:
        `上次异常（${anomaly.reason || anomaly.kind}）后处于冷却期，还需 ${mins} 分钟。` +
        (anomaly.needsHuman
          ? '请先在浏览器里手动完成验证/登录并正常浏览一会儿再开始。'
          : '连续异常会自动延长冷却时间。'),
    }
  }

  // 活跃时段闸门
  const win = isWithinActiveWindow(policy)
  if (!win.ok) {
    const mins = Math.round(msUntilActiveWindow(policy) / 60000)
    return {
      ok: false,
      error: `${win.reason}。距下一个投递窗口约 ${mins} 分钟（可在侧栏调整活跃时段）。`,
    }
  }

  const llm = await kv.getLlmConfig()
  if (!llm.baseUrl || !llm.apiKey || !llm.model) {
    return { ok: false, error: '请先配置 LLM（baseUrl / apiKey / model）' }
  }

  // 新一轮：作废任何仍在跑的旧 tick
  const gen = bumpGeneration()
  setActiveGeneration(gen)
  resetMatchLlmFailures()

  // 优先锁定「当前激活的职位列表页」（用户已切到的分类，如 项目经理/主管）
  const pinned = await resolveCurrentListTab()
  if (!pinned.ok) {
    return { ok: false, error: pinned.error }
  }

  await kv.setRunState({
    status: 'running',
    phase: 'ensure_tab',
    workerTabId: pinned.tabId,
    cursor: {
      sourceIndex: 0,
      preferFollowUp: false,
      listUrl: pinned.listUrl,
      listLabel: pinned.listLabel,
    },
    startedAt: Date.now(),
    lastTickAt: Date.now(),
    sessionOpened: 0,
    sessionReplies: 0,
    sessionHardRejected: 0,
  })
  await appendEvent({
    type: 'run_start',
    payload: {
      workerTabId: pinned.tabId,
      gen,
      listUrl: pinned.listUrl,
      listLabel: pinned.listLabel,
      mode: 'current_list',
    },
  })
  ensureAlarms()

  // 钉分类 + 首 tick 异步执行：避免阻塞侧栏 run/start 回包（否则点击像「无反应」）
  void (async () => {
    if (!(await isStillRunning(gen))) return
    if (pinned.listLabel && !isRecommendish(pinned.listLabel)) {
      try {
        await ensureOnListPage(pinned.tabId, pinned.listUrl, gen, pinned.listLabel)
        if (!(await isStillRunning(gen))) return
        const gate = await verifyListCategoryOrRestore(
          pinned.tabId,
          pinned.listLabel,
          gen,
        )
        if (!gate.ok) {
          await stopRun(
            `未能锁定分类「${pinned.listLabel}」${gate.got ? `（当前=${gate.got}）` : ''}。请点到该分类后再开始。`,
          )
          return
        }
      } catch (e) {
        /* 不阻断：tick 里还有 gate */
        await appendEvent({
          type: 'error',
          payload: {
            op: 'start_pin_category',
            error: e instanceof Error ? e.message : String(e),
            listLabel: pinned.listLabel,
          },
        }).catch(() => undefined)
      }
    }
    if (await isStillRunning(gen)) void tick()
  })()

  return { ok: true }
}

export async function handleWorkerTabRemoved(tabId: number) {
  const state = await kv.getRunState()
  if (state.status === 'running' && state.workerTabId === tabId) {
    await stopRun('工作标签被关闭')
  }
}

export async function tick() {
  if (inFlight) return
  setInFlight(true)
  const gen = activeGeneration
  try {
    await pruneIfNeeded().catch(() => undefined)
    if (!(await isStillRunning(gen))) return
    const state = await kv.getRunState()
    if (state.status !== 'running') return

    const now = Date.now()
    if (now - lastTickLogAt > 60_000) {
      setLastTickLogAt(now)
      await appendEvent({ type: 'tick', payload: { phase: state.phase } })
    }

    await kv.setRunState({ ...state, lastTickAt: now })

    // 登录 / 验证码检测（列表 worker）
    const authHit = await detectAndPauseIfAuthLost(state.workerTabId, gen)
    if (authHit) return
    if (!(await isStillRunning(gen))) return

    // 环 B：默认 on（Spec 交错）；仅 followUpInJobRun === false 时跳过
    if (state.cursor.preferFollowUp && isFollowUpInJobRunEnabled(await kv.getPolicy())) {
      const follow = await runFollowUpBatch(state.workerTabId, gen)
      if (!(await isStillRunning(gen))) return
      await patchCursor({ preferFollowUp: false }, gen)
      if (follow === 'progress') {
        scheduleSoonTick(gen, 2500)
        return
      }
      if (follow === 'soft_fail') {
        scheduleSoonTick(gen)
        return
      }
    } else if (state.cursor.preferFollowUp) {
      // 开关关闭时清掉标记，避免 cursor 卡在 true
      await patchCursor({ preferFollowUp: false }, gen)
    }

    if (!(await isStillRunning(gen))) return
    const open = await runOpenChatBatch(state.workerTabId, gen)
    if (!(await isStillRunning(gen))) return
    // 仅环 B 开启时交替跟进
    if (isFollowUpInJobRunEnabled(await kv.getPolicy())) {
      await patchCursor({ preferFollowUp: true }, gen)
    } else {
      await patchCursor({ preferFollowUp: false }, gen)
    }
    if (open === 'progress') {
      // 开聊成功后尽快进入环 B / 下一轮，不要干等 1 分钟 alarm
      scheduleSoonTick(gen, 2500)
      return
    }
    if (open === 'soft_fail') {
      // 桥接短暂失联已恢复列表：短延迟再跑，不切换 source、不硬 pause
      scheduleSoonTick(gen, 3000)
      return
    }
    // none：当前列表暂无新职位 — 不要狂刷 navigate；交给 1 分钟 alarm
    // （以前会 sourceIndex++ + scheduleSoonTick → select_source 死循环刷新）
    return
  } catch (e) {
    await appendEvent({
      type: 'error',
      payload: { message: e instanceof Error ? e.message : String(e) },
    })
  } finally {
    setInFlight(false)
  }
}

/** 当前 tick 结束后尽快再跑一轮（可被 stop 的 generation 作废） */
function scheduleSoonTick(gen: number, delayMs = 1800) {
  setTimeout(() => {
    if (gen !== activeGeneration) return
    void tick()
  }, delayMs)
}

export async function getStatus() {
  const state = await kv.getRunState()
  const daily = await getDaily()
  const anomaly = await kv.getAnomaly()
  const now = Date.now()
  const anomalyView =
    anomaly && anomaly.until > now
      ? {
          kind: anomaly.kind,
          reason: anomaly.reason,
          until: anomaly.until,
          needsHuman: anomaly.needsHuman,
        }
      : null

  // 最近错误事件里找列表空 / 分类锁（轻量可读，不引入新存储）
  let notice: string | null = null
  try {
    const recent = await listRecentEvents(12)
    for (const ev of recent) {
      if (ev.type !== 'error') continue
      const err = String((ev.payload as { error?: string } | undefined)?.error || '')
      const op = String((ev.payload as { op?: string } | undefined)?.op || '')
      if (err.includes('列表为空') || (op === 'list_jobs' && err.includes('列表'))) {
        notice = '列表暂无新职位，将按闹钟稍后重试（可换筛选或滚动加载）'
        break
      }
      if (op === 'list_category_gate') {
        notice = '分类锁定失败，已避免误扫推荐列表'
        break
      }
    }
  } catch {
    /* ignore */
  }

  return {
    state,
    todayOpened: daily.opened,
    todayReplies: daily.replies,
    todayHardRejected: daily.hardRejected ?? 0,
    sessionHardRejected:
      state.status === 'running' ? state.sessionHardRejected ?? 0 : 0,
    analytics: await summaryTodayAndWeek(),
    anomaly: anomalyView,
    notice,
  }
}
