import {
  DEFAULT_LLM,
  DEFAULT_POLICY,
  type AnomalyKind,
  type LlmConfig,
  type MessageAssistConfig,
  type Policy,
  type Profile,
  type RunState,
} from '../shared/types'

const KEYS = {
  policy: 'policy',
  llm: 'llm',
  profile: 'profile',
  runState: 'runState',
  lastOpenChatAt: 'lastOpenChatAt',
  messageAssist: 'messageAssist',
  hourlyOpened: 'hourlyOpened',
  anomaly: 'anomalyState',
} as const

/** 本地时区的小时键，如 2026-07-22T14 */
export function hourKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}`
}

type HourlyOpened = { key: string; count: number }

/** 读当前小时已开聊数；跨小时自动归零 */
export async function getHourlyOpened(now = new Date()): Promise<number> {
  const r = await chrome.storage.local.get(KEYS.hourlyOpened)
  const v = r[KEYS.hourlyOpened] as HourlyOpened | undefined
  if (!v || v.key !== hourKey(now)) return 0
  return v.count
}

export async function bumpHourlyOpened(now = new Date()): Promise<number> {
  const key = hourKey(now)
  const cur = await getHourlyOpened(now)
  const next = cur + 1
  await chrome.storage.local.set({
    [KEYS.hourlyOpened]: { key, count: next } satisfies HourlyOpened,
  })
  return next
}

/**
 * 异常退避状态。
 *
 * consecutive 只在**成功动作**后清零，因此连续异常会持续放大退避；
 * needsHuman 标记验证码/掉登录这类不可自动恢复的情形。
 */
export type AnomalyState = {
  kind: AnomalyKind
  consecutive: number
  /** 退避到期时间戳 */
  until: number
  needsHuman: boolean
  reason?: string
}

export async function getAnomaly(): Promise<AnomalyState | null> {
  const r = await chrome.storage.local.get(KEYS.anomaly)
  return (r[KEYS.anomaly] as AnomalyState | undefined) ?? null
}

export async function setAnomaly(state: AnomalyState): Promise<void> {
  await chrome.storage.local.set({ [KEYS.anomaly]: state })
}

export async function clearAnomaly(): Promise<void> {
  await chrome.storage.local.remove(KEYS.anomaly)
}

export const DEFAULT_MESSAGE_ASSIST: MessageAssistConfig = {
  enabled: true,
  batchSize: 5,
  autonomy: 'graded',
}

export async function getPolicy(): Promise<Policy> {
  const r = await chrome.storage.local.get(KEYS.policy)
  return { ...DEFAULT_POLICY, ...(r[KEYS.policy] as Policy | undefined) }
}

export async function setPolicy(policy: Policy): Promise<void> {
  await chrome.storage.local.set({ [KEYS.policy]: policy })
}

export async function getLlmConfig(): Promise<LlmConfig> {
  const r = await chrome.storage.local.get(KEYS.llm)
  return { ...DEFAULT_LLM, ...(r[KEYS.llm] as LlmConfig | undefined) }
}

export async function setLlmConfig(llm: LlmConfig): Promise<void> {
  await chrome.storage.local.set({ [KEYS.llm]: llm })
}

export async function getProfile(): Promise<Profile | null> {
  const r = await chrome.storage.local.get(KEYS.profile)
  return (r[KEYS.profile] as Profile | undefined) ?? null
}

export async function setProfile(profile: Profile): Promise<void> {
  await chrome.storage.local.set({ [KEYS.profile]: profile })
}

export async function getRunState(): Promise<RunState> {
  const r = await chrome.storage.local.get(KEYS.runState)
  return (r[KEYS.runState] as RunState | undefined) ?? { status: 'idle' }
}

export async function setRunState(state: RunState): Promise<void> {
  await chrome.storage.local.set({ [KEYS.runState]: state })
}

export async function getLastOpenChatAt(_ts?: number): Promise<number> {
  const r = await chrome.storage.local.get(KEYS.lastOpenChatAt)
  return (r[KEYS.lastOpenChatAt] as number | undefined) ?? 0
}

export async function setLastOpenChatAt(ts: number): Promise<void> {
  await chrome.storage.local.set({ [KEYS.lastOpenChatAt]: ts })
}

export async function getMessageAssist(): Promise<MessageAssistConfig> {
  const r = await chrome.storage.local.get(KEYS.messageAssist)
  return {
    ...DEFAULT_MESSAGE_ASSIST,
    ...(r[KEYS.messageAssist] as MessageAssistConfig | undefined),
  }
}

export async function setMessageAssist(cfg: MessageAssistConfig): Promise<void> {
  await chrome.storage.local.set({ [KEYS.messageAssist]: cfg })
}

export async function getAllKv() {
  const [policy, llm, profile, runState, messageAssist] = await Promise.all([
    getPolicy(),
    getLlmConfig(),
    getProfile(),
    getRunState(),
    getMessageAssist(),
  ])
  return { policy, llm, profile, runState, messageAssist }
}