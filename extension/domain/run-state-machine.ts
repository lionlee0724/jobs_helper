export type RunPhase =
  | 'idle'
  | 'ensure_tab'
  | 'sync_profile'
  | 'select_source'
  | 'next_job'
  | 'extract_jd'
  | 'llm_match'
  | 'rate_limit_wait'
  | 'open_chat'
  | 'follow_up'
  | 'paused'

export type MachineEvent =
  | { type: 'START'; workerTabId: number }
  | { type: 'PAUSE'; reason: string }
  | { type: 'RESUME' }
  | { type: 'TICK' }
  | { type: 'SET_PHASE'; phase: RunPhase }

export type MachineState = {
  status: 'idle' | 'running' | 'paused'
  phase: RunPhase
  workerTabId?: number
  reason?: string
  sourceIndex: number
  preferFollowUp: boolean
}

export function initialMachine(): MachineState {
  return {
    status: 'idle',
    phase: 'idle',
    sourceIndex: 0,
    preferFollowUp: false,
  }
}

export function reduceMachine(state: MachineState, event: MachineEvent): MachineState {
  switch (event.type) {
    case 'START':
      return {
        status: 'running',
        phase: 'ensure_tab',
        workerTabId: event.workerTabId,
        sourceIndex: 0,
        preferFollowUp: false,
      }
    case 'PAUSE':
      return {
        ...state,
        status: 'paused',
        phase: 'paused',
        reason: event.reason,
      }
    case 'RESUME':
      if (state.status !== 'paused' || state.workerTabId == null) return state
      return {
        ...state,
        status: 'running',
        phase: 'select_source',
        reason: undefined,
      }
    case 'SET_PHASE':
      return { ...state, phase: event.phase }
    case 'TICK':
      return state
    default:
      return state
  }
}

export function nextSourceIndex(current: number, total: number) {
  if (total <= 0) return 0
  return (current + 1) % total
}