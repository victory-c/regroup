/**
 * Worker-side ride logic shared by server actions (src/actions) and the cron
 * task (src/cron.ts). Both run with RBAC bypassed, so every function here
 * takes the *verified* caller id from the action context — never from params —
 * when it needs to check ownership.
 *
 * Integrations used (all through the DeepSpace proxy, owner-billed; see
 * src/integrations.ts):
 *   openweathermap/forecast   – slot weather scoring
 *   serpapi/places-search     – coffee / regroup stop suggestions
 *   anthropic/chat-completion – the ride brief
 *   email/send                – reminder emails
 */

import { z } from 'zod'
import { scoreRideWindow, type ForecastEntry } from '../lib/weather'
import { briefBasis, isBriefStale } from '../lib/brief-basis'
import type { Briefing, Reminder, Ride, Rsvp, Slot, StopOption, Vote } from '../lib/types'

export const BRIEF_MODEL = 'claude-haiku-5-5'

/** Minimal record store both `ActionTools` and the cron context can satisfy. */
export interface Store {
  /** Every matching record, oldest first: implementations page until done. */
  query<T>(collection: string, where?: Record<string, unknown>): Promise<Array<Envelope<T>>>
  get<T>(collection: string, id: string): Promise<Envelope<T> | null>
  /** Returns the new recordId; throws `DuplicateRecordError` on a `uniqueOn` clash. */
  create(collection: string, data: Record<string, unknown>): Promise<string>
  update(collection: string, id: string, patch: Record<string, unknown>): Promise<void>
  remove(collection: string, id: string): Promise<void>
  integration(endpoint: string, body: Record<string, unknown>): Promise<unknown>
}

export interface Envelope<T> {
  recordId: string
  createdBy?: string
  data: T
}

export class UserFacingError extends Error {}

/** A create refused by the collection's `uniqueOn` constraint. */
export class DuplicateRecordError extends Error {}

/** RecordRoom reports a `uniqueOn` clash as an error starting "Duplicate:". */
export function writeError(error: string | undefined): Error {
  const msg = error || 'Record write failed'
  return msg.startsWith('Duplicate:') ? new DuplicateRecordError(msg) : new Error(msg)
}

// ── slots ────────────────────────────────────────────────────────────────

/** Enough options for any real ride; stops one user flooding a ride. */
export const MAX_SLOTS_PER_RIDE = 12
const SLOT_HORIZON = 365 * 24 * 3600_000

/**
 * Any signed-in rider can propose a time (the ride is shared by link; there is
 * no membership list yet). Slots are written only here, never by the client,
 * so the ride must exist, must not be locked, and the time must be sane.
 */
export async function addSlot(
  store: Store,
  rideId: string,
  startsAt: number,
  now = Date.now(),
) {
  const ride = await mustGetRide(store, rideId)
  if (ride.data.status === 'locked') throw new UserFacingError('This ride is locked. Unlock it to add times')
  if (!Number.isFinite(startsAt) || startsAt < now) throw new UserFacingError('Pick a time in the future')
  if (startsAt - now > SLOT_HORIZON) throw new UserFacingError('Pick a time within the next year')
  const slots = await store.query<Slot>('slots', { rideId })
  const existing = slots.find((s) => s.data.startsAt === startsAt)
  if (existing) return { slotId: existing.recordId, created: false }
  if (slots.length >= MAX_SLOTS_PER_RIDE) {
    throw new UserFacingError(`A ride can have at most ${MAX_SLOTS_PER_RIDE} proposed times`)
  }
  const slotId = await store.create('slots', { rideId, startsAt: Math.round(startsAt) })
  return { slotId, created: true }
}

/**
 * The proposer or the organizer can withdraw a time while the ride is still
 * being planned. Once locked, no slot changes, so `lockedStartsAt` can never
 * drift from the slot it was copied from. Its votes go with it.
 */
export async function removeSlot(store: Store, callerId: string, slotId: string) {
  if (typeof slotId !== 'string' || !slotId) throw new UserFacingError('Missing slotId')
  const slot = await store.get<Slot>('slots', slotId)
  if (!slot) throw new UserFacingError('That time no longer exists')
  const ride = await mustGetRide(store, slot.data.rideId)
  if (slot.createdBy !== callerId && ride.createdBy !== callerId) {
    throw new UserFacingError('Only whoever proposed this time, or the organizer, can remove it')
  }
  if (ride.data.status === 'locked') throw new UserFacingError('Unlock the ride before removing times')
  for (const v of await store.query<Vote>('votes', { slotId })) await store.remove('votes', v.recordId)
  await store.remove('slots', slotId)
  return { removed: true }
}

// ── votes & RSVPs ────────────────────────────────────────────────────────

const VOTE_CHOICES = ['yes', 'maybe', 'no'] as const
const RSVP_STATUSES = ['going', 'out'] as const

/**
 * Create, change or (with `value: null`) clear the caller's one row in a
 * one-per-user collection. `uniqueOn` + `userBound` already stop duplicates
 * and impersonation; this keeps a double click from surfacing as an error.
 */
async function upsertOwn(
  store: Store,
  collection: 'votes' | 'rsvps',
  key: Record<string, string>,
  field: 'choice' | 'status',
  value: string | null,
  data: Record<string, unknown>,
) {
  const findMine = () => store.query<Record<string, unknown>>(collection, { ...key })
  const mine = await findMine()
  if (value === null) {
    for (const r of mine) await store.remove(collection, r.recordId)
    return
  }
  if (mine[0]) {
    if (mine[0].data[field] !== value) await store.update(collection, mine[0].recordId, { [field]: value })
    return
  }
  try {
    await store.create(collection, { ...data, [field]: value })
  } catch (e) {
    if (!(e instanceof DuplicateRecordError)) throw e
    const raced = (await findMine())[0]
    if (raced) await store.update(collection, raced.recordId, { [field]: value })
  }
}

/**
 * The caller's vote on a slot. The slot must exist and its ride must still be
 * open: once the organizer locks a time, votes are frozen, so the tally the
 * decision was made on (and the brief built from it) can't shift afterwards.
 * `rideId` comes from the slot, never the client, so a vote can't be filed
 * under a ride its slot doesn't belong to.
 */
export async function castVote(
  store: Store,
  callerId: string,
  slotId: string,
  choice: string | null,
) {
  if (choice !== null && !(VOTE_CHOICES as readonly string[]).includes(choice)) {
    throw new UserFacingError('Vote must be yes, maybe or no')
  }
  if (typeof slotId !== 'string' || !slotId) throw new UserFacingError('Missing slotId')
  const slot = await store.get<Slot>('slots', slotId)
  if (!slot) throw new UserFacingError('That time no longer exists')
  const ride = await mustGetRide(store, slot.data.rideId)
  if (ride.data.status === 'locked') throw new UserFacingError('Voting is closed: this ride is locked')
  await upsertOwn(store, 'votes', { slotId, userId: callerId }, 'choice', choice, {
    rideId: slot.data.rideId,
    slotId,
  })
  return { choice }
}

/** The caller's RSVP. Only a locked ride has a time to RSVP to. */
export async function setRsvp(store: Store, callerId: string, rideId: string, status: string | null) {
  if (status !== null && !(RSVP_STATUSES as readonly string[]).includes(status)) {
    throw new UserFacingError('RSVP must be going or out')
  }
  const ride = await mustGetRide(store, rideId)
  if (ride.data.status !== 'locked') throw new UserFacingError('RSVPs open once the organizer locks a time')
  const startsAt = ride.data.lockedStartsAt
  await upsertOwn(store, 'rsvps', { rideId, userId: callerId }, 'status', status, { rideId, startsAt })
  // An older answer for this ride may predate the current time; restamp it.
  const mine = await store.query<Rsvp>('rsvps', { rideId, userId: callerId })
  for (const r of mine) if (r.data.startsAt !== startsAt) await store.update('rsvps', r.recordId, { startsAt })
  return { status }
}

// ── weather ──────────────────────────────────────────────────────────────

const FORECAST_TTL = 30 * 60_000

/**
 * Re-score every slot of a ride. The forecast is cached on the ride for 30
 * minutes, so many riders opening the page (or adding slots) costs at most one
 * weather API call per ride per half hour; scoring itself is free.
 */
export async function scoreSlots(store: Store, rideId: string, now = Date.now()) {
  const ride = await mustGetRide(store, rideId)
  let forecast = ride.data.forecastCache?.entries as ForecastEntry[] | undefined
  const cached = !!forecast && now - (ride.data.forecastCache?.fetchedAt ?? 0) < FORECAST_TTL

  if (!cached) {
    const fresh = (await store.integration('openweathermap/forecast', {
      q: ride.data.weatherQuery,
      units: 'imperial',
    })) as ForecastEntry[]
    if (!Array.isArray(fresh)) throw new UserFacingError('Weather service returned no forecast')
    forecast = fresh
    await store.update('rides', rideId, { forecastCache: { fetchedAt: now, entries: fresh } })
  }

  const slots = await store.query<Slot>('slots', { rideId })
  for (const slot of slots) {
    const weather = scoreRideWindow(forecast!, slot.data.startsAt, ride.data.durationHours ?? 2, now)
    await store.update('slots', slot.recordId, { weather })
  }
  return { scored: slots.length, cached }
}

/** Organizer: lock (or with slotId=null, unlock) the ride's time. */
export async function lockSlot(store: Store, callerId: string, rideId: string, slotId: string | null) {
  const ride = await mustGetRide(store, rideId)
  assertOrganizer(ride, callerId)
  if (slotId === null) {
    await store.update('rides', rideId, {
      status: 'planning',
      lockedSlotId: null,
      lockedStartsAt: null,
      reminderSentAt: null,
    })
    return { locked: false }
  }
  const slot = await store.get<Slot>('slots', slotId)
  if (!slot || slot.data.rideId !== rideId) throw new UserFacingError('That time is not part of this ride')
  // An RSVP answers one specific time. Re-locking to a different time drops
  // the old answers, so nobody is counted (or reminded) for a time they never
  // said yes to. Unlocking and re-locking the same time keeps them.
  for (const r of await store.query<Rsvp>('rsvps', { rideId })) {
    if (r.data.startsAt !== slot.data.startsAt) await store.remove('rsvps', r.recordId)
  }
  await store.update('rides', rideId, {
    status: 'locked',
    lockedSlotId: slotId,
    lockedStartsAt: slot.data.startsAt,
    // A new time means a new reminder.
    reminderSentAt: null,
  })
  return { locked: true }
}

// ── stops ────────────────────────────────────────────────────────────────

interface SerpLocalResult {
  title?: string
  address?: string
  rating?: number
  reviews?: number
  type?: string
  operating_hours?: Record<string, string>
  place_id?: string
}

export async function findStops(store: Store, callerId: string, rideId: string, query: string) {
  const ride = await mustGetRide(store, rideId)
  assertOrganizer(ride, callerId)
  const q = query.trim().slice(0, 80)
  if (!q) throw new UserFacingError('Say what kind of stop you want, e.g. "coffee"')

  const res = (await store.integration('serpapi/places-search', {
    q: `${q} near ${ride.data.startArea}`,
    hl: 'en',
  })) as { local_results?: SerpLocalResult[] }

  const options: StopOption[] = (res?.local_results ?? []).slice(0, 5).map((r) => ({
    name: r.title ?? 'Unnamed place',
    address: r.address,
    rating: r.rating,
    reviews: r.reviews,
    type: r.type,
    hours: r.operating_hours,
    mapsUrl: r.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(r.place_id)}`
      : undefined,
  }))

  await store.update('rides', rideId, {
    stopOptions: options,
    stopQuery: q,
    // A fresh search invalidates the previous pick.
    chosenStopIndex: null,
  })
  return { count: options.length }
}

// ── AI brief ─────────────────────────────────────────────────────────────

// Validate the shape strictly but the size leniently: a model that writes a
// slightly long summary should still produce a brief, just a clipped one.
const clip = (n: number) => z.string().transform((s) => (s.length > n ? `${s.slice(0, n - 1)}…` : s))
const BriefSchema = z.object({
  recommendedSlotId: z.string().nullable().catch(null),
  headline: clip(140),
  summary: clip(600),
  bullets: z.array(clip(220)).transform((a) => a.slice(0, 6)),
  warnings: z.array(clip(220)).catch([]).transform((a) => a.slice(0, 5)),
})

export function formatTime(ms: number, tz?: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz || 'UTC',
    timeZoneName: 'short',
  }).format(new Date(ms))
}

function weekdayKey(ms: number, tz?: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz || 'UTC' })
    .format(new Date(ms))
    .toLowerCase()
}

/** Build the facts the model reasons over. Exported for unit tests. */
export function buildBriefContext(
  ride: Envelope<Ride>,
  slots: Array<Envelope<Slot>>,
  votes: Array<Envelope<Vote>>,
  goingCount: number,
) {
  const tz = ride.data.timezone
  const stop =
    ride.data.chosenStopIndex != null ? ride.data.stopOptions?.[ride.data.chosenStopIndex] : undefined
  return {
    ride: {
      title: ride.data.title,
      notes: ride.data.notes ?? '',
      startArea: ride.data.startArea,
      durationHours: ride.data.durationHours ?? 2,
      distanceMi: ride.data.distanceMi ?? null,
      pace: ride.data.pace ?? 'steady',
      status: ride.data.status ?? 'planning',
      lockedSlotId: ride.data.lockedSlotId ?? null,
      ridersGoing: goingCount,
    },
    slots: slots
      .slice()
      .sort((a, b) => a.data.startsAt - b.data.startsAt)
      .map((s) => {
        const vs = votes.filter((v) => v.data.slotId === s.recordId)
        return {
          slotId: s.recordId,
          startsLocal: formatTime(s.data.startsAt, tz),
          weekday: weekdayKey(s.data.startsAt, tz),
          votes: {
            yes: vs.filter((v) => v.data.choice === 'yes').length,
            maybe: vs.filter((v) => v.data.choice === 'maybe').length,
            no: vs.filter((v) => v.data.choice === 'no').length,
          },
          weather: s.data.weather ?? { status: 'unknown' },
        }
      }),
    stop: stop ? { name: stop.name, address: stop.address, hours: stop.hours ?? null } : null,
  }
}

const SYSTEM_PROMPT = `You are the ride captain's assistant for a small group bike ride.
You get JSON facts: the ride, candidate time slots (with rider votes and a weather score 0-100 computed from a 3-hour forecast), and an optional mid-ride stop with its weekly opening hours.
Write a short, practical ride brief for the group chat.

Rules:
- Recommend exactly one slotId from the input (or null if there are no slots). Weigh rider availability first (yes counts double maybe), then weather. If a slot is already locked, recommend that one and focus the brief on it.
- Only state facts present in the input. The forecast has no wind data; do not invent wind. Do not invent distances, routes, or places.
- If a stop is given, check its hours on the recommended slot's weekday against the ride window (start + durationHours/2 is roughly when the group reaches it). Warn if it looks closed or the hours are unknown.
- Warn about rain, cold, heat, out-of-range forecasts, or thin turnout (fewer than 3 yes votes).
- Bullets: what to bring/wear for the recommended slot, the stop plan, and the pace.
- Keep it short — it is read on a phone: headline at most 12 words, summary at most 50 words, at most 4 bullets and 3 warnings, each at most 20 words.
- Respond with ONLY a JSON object: {"recommendedSlotId": string|null, "headline": string, "summary": string, "bullets": string[], "warnings": string[]}. No markdown fences.`

export async function generateBrief(store: Store, callerId: string, rideId: string, now = Date.now()) {
  const ride = await mustGetRide(store, rideId)
  assertOrganizer(ride, callerId)
  if (ride.data.briefing && now - ride.data.briefing.generatedAt < 30_000) {
    throw new UserFacingError('A brief was just generated — give it a few seconds')
  }

  const [slots, votes, rsvps] = await Promise.all([
    store.query<Slot>('slots', { rideId }),
    store.query<Vote>('votes', { rideId }),
    store.query<Rsvp>('rsvps', { rideId }),
  ])
  if (slots.length === 0) throw new UserFacingError('Add at least one time slot first')

  const context = buildBriefContext(
    ride,
    slots,
    votes,
    rsvps.filter((r) => r.data.status === 'going').length,
  )

  const res = (await store.integration('anthropic/chat-completion', {
    model: BRIEF_MODEL,
    // Headroom well above the ~300 tokens the word budgets in the prompt
    // allow: a brief cut off mid-JSON is unusable, a long one gets clipped.
    max_tokens: 2000,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(context) }],
  })) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string }

  if (res?.stop_reason === 'max_tokens') {
    console.error('[brief] model output hit max_tokens; JSON is likely truncated')
  }
  const text = (res?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
  const parsed = parseBrief(text, new Set(slots.map((s) => s.recordId)))

  const briefing: Briefing = {
    ...parsed,
    generatedAt: now,
    model: BRIEF_MODEL,
    basis: briefBasis(ride.data, slots, votes, rsvps),
  }
  await store.update('rides', rideId, { briefing })
  return briefing
}

/** Parse + validate model output. Exported for unit tests. */
export function parseBrief(text: string, validSlotIds: Set<string>) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    console.error(`[brief] no JSON object in model output: ${JSON.stringify(text.slice(0, 200))}`)
    throw new UserFacingError('The AI brief came back malformed — try again')
  }
  let json: unknown
  try {
    json = JSON.parse(text.slice(start, end + 1))
  } catch {
    console.error(`[brief] unparseable JSON: ${JSON.stringify(text.slice(start, start + 200))}`)
    throw new UserFacingError('The AI brief came back malformed — try again')
  }
  const result = BriefSchema.safeParse(json)
  if (!result.success) {
    console.error(`[brief] schema mismatch: ${result.error.message.slice(0, 300)}`)
    throw new UserFacingError('The AI brief came back malformed — try again')
  }
  const brief = result.data
  // Never trust a model-supplied id we didn't give it.
  if (brief.recommendedSlotId && !validSlotIds.has(brief.recommendedSlotId)) {
    brief.recommendedSlotId = null
  }
  return brief
}

// ── reminders ────────────────────────────────────────────────────────────

const DAY = 24 * 3600_000

/** Give up on a rider after this many failed sends for the same ride time. */
export const REMINDER_MAX_ATTEMPTS = 5
/** A claim older than this is presumed to be from a run that died mid-send. */
export const REMINDER_CLAIM_TTL = 15 * 60_000

/**
 * Email every rider marked "going" on locked rides starting within 24h.
 *
 * Delivery is tracked per rider and per ride time in `reminders`, one record
 * per attempt. A send that fails is retried on the next tick (up to
 * REMINDER_MAX_ATTEMPTS); a rider who RSVPs after the first run still gets
 * one. Each attempt is claimed by creating its record first, and `uniqueOn`
 * makes that claim atomic, so the cron and "Send now" racing each other can't
 * both email the same rider.
 *
 * The guarantee is at-least-once, not exactly-once: if a run dies after the
 * email goes out but before the attempt is marked sent, the claim expires
 * after REMINDER_CLAIM_TTL and the rider may get a second copy. The email
 * integration takes no idempotency key, so that window can't be closed here.
 */
export async function sendDueReminders(store: Store, appOrigin: string, now = Date.now()) {
  const locked = await store.query<Ride>('rides', { status: 'locked' })
  let sent = 0
  for (const ride of locked) {
    const t = ride.data.lockedStartsAt
    if (!t || t < now || t - now > DAY) continue
    try {
      sent += (await sendReminderForRide(store, ride, appOrigin, now)).sent
    } catch (e) {
      // One bad ride must not stop the others; it is retried next tick.
      console.error(`[reminders] ride ${ride.recordId} failed: ${String(e)}`)
    }
  }
  return { sent }
}

export async function sendReminderForRide(
  store: Store,
  ride: Envelope<Ride>,
  appOrigin: string,
  now = Date.now(),
) {
  const startsAt = ride.data.lockedStartsAt
  if (!startsAt) return { sent: 0, failed: 0, pending: 0 }

  const rsvps = await store.query<Rsvp>('rsvps', { rideId: ride.recordId })
  const going = [...new Set(rsvps.filter((r) => r.data.status === 'going').map((r) => r.data.userId))].filter(
    (id): id is string => !!id,
  )
  const attempts = await store.query<Reminder>('reminders', { rideId: ride.recordId, startsAt })
  const byRider = new Map<string, Array<Envelope<Reminder>>>()
  for (const a of attempts) byRider.set(a.data.riderId, [...(byRider.get(a.data.riderId) ?? []), a])

  const due: Array<{ riderId: string; attempt: number }> = []
  for (const riderId of going) {
    const mine = byRider.get(riderId) ?? []
    if (mine.some((a) => a.data.status === 'sent')) continue
    if (mine.length >= REMINDER_MAX_ATTEMPTS) continue
    const inFlight = mine.some((a) => a.data.status === 'sending' && now - a.data.claimedAt < REMINDER_CLAIM_TTL)
    if (inFlight) continue
    due.push({ riderId, attempt: Math.max(0, ...mine.map((a) => a.data.attempt)) + 1 })
  }
  if (due.length === 0) return { sent: 0, failed: 0, pending: 0 }

  const when = ride.data.lockedStartsAt ? formatTime(ride.data.lockedStartsAt, ride.data.timezone) : ''
  const stop =
    ride.data.chosenStopIndex != null ? ride.data.stopOptions?.[ride.data.chosenStopIndex] : undefined
  const link = `${appOrigin}/rides/${ride.recordId}`

  // Only quote the AI brief if it still describes this ride. One written
  // before the lock, a vote or an RSVP can say things like "no one's
  // committed yet" about a ride that's locked and full, so leave it out and
  // point at the page instead of mailing stale advice.
  const [slots, votes] = await Promise.all([
    store.query<Slot>('slots', { rideId: ride.recordId }),
    store.query<Vote>('votes', { rideId: ride.recordId }),
  ])
  const written = ride.data.briefing
  const stale = isBriefStale(written, briefBasis(ride.data, slots, votes, rsvps))
  const brief = written && !stale ? written : undefined

  const lines = [
    `${ride.data.title} — ${when}`,
    `Meet: ${ride.data.startArea}`,
    stop ? `Regroup stop: ${stop.name}${stop.address ? ` (${stop.address})` : ''}` : '',
    '',
    brief ? brief.headline : '',
    ...(brief?.bullets ?? []).map((b) => `• ${b}`),
    ...(brief?.warnings ?? []).map((w) => `⚠ ${w}`),
    written && stale ? 'The ride brief was written before the latest changes, so it is not included here.' : '',
    '',
    `Ride page: ${link}`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '')

  // One email per rider so nobody sees anyone else's address.
  let sent = 0
  let failed = 0
  for (const { riderId, attempt } of due) {
    const user = await store.get<{ email?: string }>('users', riderId)
    const to = user?.data.email
    if (!to) continue // nothing to retry until they have an address

    let attemptId: string
    try {
      attemptId = await store.create('reminders', {
        rideId: ride.recordId,
        riderId,
        startsAt,
        attempt,
        status: 'sending',
        claimedAt: now,
      })
    } catch (e) {
      if (e instanceof DuplicateRecordError) continue // another run claimed this attempt
      throw e
    }

    try {
      await store.integration('email/send', {
        to,
        subject: `Coming up: ${ride.data.title}`,
        text: lines.join('\n'),
      })
    } catch (e) {
      failed++
      console.error(`[reminders] send failed for ride ${ride.recordId} (attempt ${attempt}): ${String(e)}`)
      await store.update('reminders', attemptId, { status: 'failed', error: String(e).slice(0, 300) })
      continue
    }
    await store.update('reminders', attemptId, { status: 'sent' })
    sent++
  }
  if (sent > 0) await store.update('rides', ride.recordId, { reminderSentAt: now })
  return { sent, failed, pending: due.length }
}

// ── helpers ──────────────────────────────────────────────────────────────

async function mustGetRide(store: Store, rideId: string) {
  if (typeof rideId !== 'string' || !rideId) throw new UserFacingError('Missing rideId')
  const ride = await store.get<Ride>('rides', rideId)
  if (!ride) throw new UserFacingError('Ride not found')
  return ride
}

function assertOrganizer(ride: Envelope<Ride>, callerId: string) {
  if (ride.createdBy !== callerId) throw new UserFacingError('Only the ride organizer can do that')
}

/** Integration responses come back either bare or wrapped in {success,data}. */
export function unwrapIntegration(res: unknown): unknown {
  if (res && typeof res === 'object' && 'success' in res) {
    const r = res as { success: boolean; data?: unknown; error?: string }
    if (!r.success) throw new UserFacingError(r.error || 'Integration call failed')
    return r.data
  }
  return res
}
