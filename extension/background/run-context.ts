/**
 * 运行时共享状态：generation / stop / session 计数 / sleep。
 * 供 scheduler 与各 flow 模块协作式取消，避免循环依赖把状态拆散。
 */
import * as kv from '../data/kv'
import { appendEvent } from '../data/repos/events'

let runGeneration = 0
/** 当前有效 generation；stop / 新 start 会 bump */
export let activeGeneration = 0
/** tick 互斥 */
export let inFlight = false
export let lastTickLogAt = 0
/** stop 串行，避免连点并发写多条 pause */
let stopChain: Promise<void> | null = null
/**
 * 本轮 run 连续匹配 LLM 失败（via=llm_error）计数。
 * startRun 清零；一次非 llm_error 的匹配结论也清零；≥3 → pause。
 */
export let consecutiveMatchLlmFailures = 0
export const MATCH_LLM_FAIL_CIRCUIT = 3

export function bumpGeneration() {
  runGeneration += 1
  return runGeneration
}

export function setActiveGeneration(gen: number) {
  activeGeneration = gen
}

export function setInFlight(v: boolean) {
  inFlight = v
}

export function setLastTickLogAt(ts: number) {
  lastTickLogAt = ts
}

export function resetMatchLlmFailures() {
  consecutiveMatchLlmFailures = 0
}

export function bumpMatchLlmFailure() {
  consecutiveMatchLlmFailures += 1
  return consecutiveMatchLlmFailures
}

export function clearMatchLlmFailures() {
  consecutiveMatchLlmFailures = 0
}

/** 协作式取消：storage 已 paused 或 generation 已失效 → 立刻停 */
export async function isStillRunning(gen: number): Promise<boolean> {
  if (gen !== activeGeneration) return false
  const state = await kv.getRunState()
  return state.status === 'running'
}

export async function stopRun(reason = '用户停止') {
  // 先 bump，让 in-flight 的 for 循环/await 间隙立刻退出，再写 storage
  activeGeneration = bumpGeneration()

  const job = async () => {
    const state = await kv.getRunState()
    if (state.status === 'paused' && state.reason === reason) return

    const workerTabId =
      state.status === 'running'
        ? state.workerTabId
        : state.status === 'paused'
          ? state.workerTabId
          : undefined

    await kv.setRunState({
      status: 'paused',
      reason,
      workerTabId,
    })
    await appendEvent({ type: 'run_pause', payload: { reason } })
  }

  // 严格排队：连点只串行执行，后到的会看到已 paused 并幂等返回
  stopChain = (stopChain ?? Promise.resolve()).then(job, job)
  try {
    await stopChain
  } finally {
    // 仅当自己是链尾时清空，避免误清后来者
    // 简化：保留 resolved chain 也无妨；下次 then 接上即可
  }
}

export async function patchCursor(
  patch: Partial<{
    sourceIndex: number
    preferFollowUp: boolean
    listUrl?: string
    listLabel?: string
  }>,
  gen?: number,
) {
  if (gen != null && !(await isStillRunning(gen))) return
  const state = await kv.getRunState()
  if (state.status !== 'running') return
  await kv.setRunState({
    ...state,
    cursor: {
      ...state.cursor,
      ...patch,
      // 绝不被空 patch 冲掉锁定
      listUrl: patch.listUrl ?? state.cursor.listUrl,
      listLabel: patch.listLabel ?? state.cursor.listLabel,
    },
  })
}

export async function setPhase(phase: string, gen?: number) {
  if (gen != null && !(await isStillRunning(gen))) return
  const state = await kv.getRunState()
  if (state.status !== 'running') return
  await kv.setRunState({ ...state, phase })
}

export async function getSessionCounters(): Promise<{
  sessionOpened: number
  sessionReplies: number
}> {
  const state = await kv.getRunState()
  if (state.status !== 'running') return { sessionOpened: 0, sessionReplies: 0 }
  return {
    sessionOpened: state.sessionOpened ?? 0,
    sessionReplies: state.sessionReplies ?? 0,
  }
}

export async function bumpSessionOpened(gen?: number): Promise<void> {
  if (gen != null && !(await isStillRunning(gen))) return
  const state = await kv.getRunState()
  if (state.status !== 'running') return
  await kv.setRunState({
    ...state,
    sessionOpened: (state.sessionOpened ?? 0) + 1,
  })
}

export async function bumpSessionReplies(gen?: number): Promise<void> {
  if (gen != null && !(await isStillRunning(gen))) return
  const state = await kv.getRunState()
  if (state.status !== 'running') return
  await kv.setRunState({
    ...state,
    sessionReplies: (state.sessionReplies ?? 0) + 1,
  })
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 可被 stop 打断的等待：每 400ms 检查一次 generation / runState */
export async function sleepWhileRunning(ms: number, gen: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!(await isStillRunning(gen))) return false
    const slice = Math.min(400, end - Date.now())
    if (slice <= 0) break
    await sleep(slice)
  }
  return isStillRunning(gen)
}

export type BatchOutcome = 'progress' | 'none' | 'soft_fail'
