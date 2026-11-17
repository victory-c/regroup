/**
 * Server actions — exposed at POST /api/actions/<name>, called with the
 * caller's Bearer JWT (verified before the handler runs).
 *
 * Why actions instead of client-side `integration.post`:
 *   - The results (weather, stops, AI brief) are written into fields the
 *     client is NOT allowed to write (see writableFields in rides-schema), so
 *     every rider sees the same server-computed data in realtime.
 *   - Organizer-only operations and cooldowns are enforced here, next to the
 *     owner-billed integration calls, instead of trusting the UI.
 */

import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Ride } from '../lib/types'
import {
  findStops,
  generateBrief,
  lockSlot,
  scoreSlots,
  sendReminderForRide,
  UserFacingError,
} from '../server/ride-ops'
import { storeFromActionTools } from '../server/stores'

function appOrigin(env: Env) {
  return `https://${env.APP_NAME}.app.space`
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() }
  } catch (e) {
    if (e instanceof UserFacingError) return { success: false, error: e.message }
    console.error(`[action] unexpected error: ${e instanceof Error ? e.stack : String(e)}`)
    return { success: false, error: 'Something went wrong — try again' }
  }
}

export const actions: Record<string, ActionHandler<Env>> = {
  /** Any signed-in rider: (re)score every slot of a ride against the forecast. */
  scoreSlots: ({ params, tools }) =>
    run(() => scoreSlots(storeFromActionTools(tools), String(params.rideId ?? ''))),

  /** Organizer: search for mid-ride stops near the start area. */
  findStops: ({ params, tools, userId }) =>
    run(() =>
      findStops(
        storeFromActionTools(tools),
        userId,
        String(params.rideId ?? ''),
        String(params.query ?? ''),
      ),
    ),

  /** Organizer: generate the AI ride brief from votes + weather + stop hours. */
  generateBrief: ({ params, tools, userId }) =>
    run(() => generateBrief(storeFromActionTools(tools), userId, String(params.rideId ?? ''))),

  /** Organizer: lock a slot (slotId) or unlock (slotId: null). */
  lockSlot: ({ params, tools, userId }) =>
    run(() =>
      lockSlot(
        storeFromActionTools(tools),
        userId,
        String(params.rideId ?? ''),
        params.slotId == null ? null : String(params.slotId),
      ),
    ),

  /** Organizer: send the reminder email now instead of waiting for the cron. */
  sendReminderNow: ({ params, tools, userId, env }) =>
    run(async () => {
      const store = storeFromActionTools(tools)
      const ride = await store.get<Ride>('rides', String(params.rideId ?? ''))
      if (!ride) throw new UserFacingError('Ride not found')
      if (ride.createdBy !== userId) throw new UserFacingError('Only the ride organizer can do that')
      if (ride.data.status !== 'locked') throw new UserFacingError('Lock a time before sending reminders')
      if (ride.data.reminderSentAt && Date.now() - ride.data.reminderSentAt < 10 * 60_000) {
        throw new UserFacingError('Reminder already sent in the last 10 minutes')
      }
      const sent = await sendReminderForRide(store, ride, appOrigin(env))
      return { sent }
    }),

  /** Organizer: delete a ride and everything hanging off it. */
  deleteRide: ({ params, tools, userId }) =>
    run(async () => {
      const rideId = String(params.rideId ?? '')
      const store = storeFromActionTools(tools)
      const ride = await store.get<Ride>('rides', rideId)
      if (!ride) throw new UserFacingError('Ride not found')
      if (ride.createdBy !== userId) throw new UserFacingError('Only the ride organizer can do that')
      for (const coll of ['votes', 'rsvps', 'slots']) {
        // deleteWhere is paged; loop until a page comes back short.
        for (;;) {
          const r = await tools.deleteWhere(coll, { rideId }, 500)
          if (!r.success) throw new Error(r.error)
          if ((r.data as { deleted: number }).deleted < 500) break
        }
      }
      const r = await tools.remove('rides', rideId)
      if (!r.success) throw new Error(r.error)
      return { deleted: true }
    }),
}
