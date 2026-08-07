import type { EventRecord, EventType } from '../../shared/types'
import { getDb, localDay, newId } from '../db'
import { bumpDailyFromEvent } from './daily-stats'

export async function appendEvent(input: {
  type: EventType
  jobId?: string
  threadId?: string
  payload?: Record<string, unknown>
}): Promise<EventRecord> {
  const ts = Date.now()
  const record: EventRecord = {
    id: newId(),
    ts,
    day: localDay(ts),
    type: input.type,
    jobId: input.jobId,
    threadId: input.threadId,
    payload: input.payload,
  }
  await getDb().events.add(record)
  await bumpDailyFromEvent(record)
  return record
}

export async function listRecentEvents(limit = 50): Promise<EventRecord[]> {
  return getDb().events.orderBy('ts').reverse().limit(limit).toArray()
}

export async function listAllEvents() {
  return getDb().events.orderBy('ts').toArray()
}

export async function countEvents(): Promise<number> {
  return getDb().events.count()
}