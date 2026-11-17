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
import type { Briefing, Ride, Rsvp, Slot, StopOption, Vote } from '../lib/types'

export const BRIEF_MODEL = 'claude-haiku-5-5'

/** Minimal record store both `ActionTools` and the cron context can satisfy. */
export interface Store {
  query<T>(collection: string, where?: Record<string, unknown>): Promise<Array<Envelope<T>>>
  get<T>(collection: string, id: string): Promise<Envelope<T> | null>
  update(collection: string, id: string, patch: Record<string, unknown>): Promise<void>
  integration(endpoint: string, body: Record<string, unknown>): Promise<unknown>
}

export interface Envelope<T> {
  recordId: string
  createdBy?: string
  data: T
}

export class UserFacingError extends Error {}

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

  const briefing: Briefing = { ...parsed, generatedAt: now, model: BRIEF_MODEL }
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

/**
 * Email every rider marked "going" on locked rides starting within 24h.
 * Idempotent via `reminderSentAt`, so the cron can run as often as it likes.
 */
export async function sendDueReminders(store: Store, appOrigin: string, now = Date.now()) {
  const locked = await store.query<Ride>('rides', { status: 'locked' })
  let sent = 0
  for (const ride of locked) {
    const t = ride.data.lockedStartsAt
    if (!t || ride.data.reminderSentAt || t < now || t - now > DAY) continue
    sent += await sendReminderForRide(store, ride, appOrigin, now)
  }
  return { sent }
}

export async function sendReminderForRide(
  store: Store,
  ride: Envelope<Ride>,
  appOrigin: string,
  now = Date.now(),
) {
  const rsvps = await store.query<Rsvp>('rsvps', { rideId: ride.recordId })
  const going = rsvps.filter((r) => r.data.status === 'going' && r.data.userId)
  const emails: string[] = []
  for (const r of going) {
    const user = await store.get<{ email?: string }>('users', r.data.userId!)
    if (user?.data.email) emails.push(user.data.email)
  }
  // Mark first so a crash mid-send can't double-email on the next tick.
  await store.update('rides', ride.recordId, { reminderSentAt: now })
  if (emails.length === 0) return 0

  const when = ride.data.lockedStartsAt ? formatTime(ride.data.lockedStartsAt, ride.data.timezone) : ''
  const stop =
    ride.data.chosenStopIndex != null ? ride.data.stopOptions?.[ride.data.chosenStopIndex] : undefined
  const brief = ride.data.briefing
  const link = `${appOrigin}/rides/${ride.recordId}`

  const lines = [
    `${ride.data.title} — ${when}`,
    `Meet: ${ride.data.startArea}`,
    stop ? `Regroup stop: ${stop.name}${stop.address ? ` (${stop.address})` : ''}` : '',
    '',
    brief ? brief.headline : '',
    ...(brief?.bullets ?? []).map((b) => `• ${b}`),
    ...(brief?.warnings ?? []).map((w) => `⚠ ${w}`),
    '',
    `Ride page: ${link}`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '')

  // One email per rider so nobody sees anyone else's address.
  let delivered = 0
  for (const to of emails) {
    try {
      await store.integration('email/send', {
        to,
        subject: `Coming up: ${ride.data.title}`,
        text: lines.join('\n'),
      })
      delivered++
    } catch (e) {
      console.error(`[reminders] send failed for ride ${ride.recordId}: ${String(e)}`)
    }
  }
  return delivered
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
