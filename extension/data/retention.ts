import { getDb } from './db'
import { countEvents } from './repos/events'
import { recomputeDays } from './repos/daily-stats'

const MAX_EVENTS = 20_000
const EVENT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const JOB_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

export async function pruneIfNeeded(): Promise<{ eventsDeleted: number; jobsDeleted: number }> {
  const db = getDb()
  let eventsDeleted = 0
  let jobsDeleted = 0
  const now = Date.now()

  const oldEvents = await db.events.where('ts').below(now - EVENT_MAX_AGE_MS).toArray()
  if (oldEvents.length) {
    await db.events.bulkDelete(oldEvents.map((e) => e.id))
    eventsDeleted += oldEvents.length
    await recomputeDays(oldEvents.map((e) => e.day))
  }

  const total = await countEvents()
  if (total > MAX_EVENTS) {
    const overflow = total - MAX_EVENTS
    const oldest = await db.events.orderBy('ts').limit(overflow).toArray()
    if (oldest.length) {
      await db.events.bulkDelete(oldest.map((e) => e.id))
      eventsDeleted += oldest.length
      await recomputeDays(oldest.map((e) => e.day))
    }
  }

  const oldJobs = await db.jobs
    .where('lastSeenAt')
    .below(now - JOB_MAX_AGE_MS)
    .toArray()
  const toDelete = oldJobs.filter((j) => j.outcome !== 'opened').map((j) => j.id)
  if (toDelete.length) {
    await db.jobs.bulkDelete(toDelete)
    jobsDeleted = toDelete.length
  }

  return { eventsDeleted, jobsDeleted }
}