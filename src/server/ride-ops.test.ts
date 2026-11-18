import { describe, expect, it, vi } from 'vitest'
import {
  addSlot,
  buildBriefContext,
  DuplicateRecordError,
  lockSlot,
  MAX_SLOTS_PER_RIDE,
  parseBrief,
  REMINDER_CLAIM_TTL,
  REMINDER_MAX_ATTEMPTS,
  removeSlot,
  sendDueReminders,
  sendReminderForRide,
  UserFacingError,
  type Envelope,
  type Store,
} from './ride-ops'
import { collectPages } from './stores'
import type { Reminder, Ride, Rsvp, Slot, Vote } from '../lib/types'

const ride: Envelope<Ride> = {
  recordId: 'ride1',
  createdBy: 'org',
  data: {
    title: 'Grizzly Peak loop',
    startArea: 'Berkeley, California, US',
    weatherQuery: 'Berkeley,CA,US',
    timezone: 'America/Los_Angeles',
    durationHours: 3,
    pace: 'steady',
    status: 'planning',
    chosenStopIndex: 0,
    stopOptions: [{ name: 'Hidden Cafe', hours: { saturday: '8:30 AM–5 PM' } }],
  },
}

describe('parseBrief', () => {
  const ids = new Set(['s1', 's2'])
  const good = {
    recommendedSlotId: 's1',
    headline: 'Saturday 9am wins',
    summary: 'Most riders are free and it stays dry.',
    bullets: ['Bring a vest'],
    warnings: [],
  }

  it('accepts valid JSON, even with surrounding prose', () => {
    expect(parseBrief(`Here you go:\n${JSON.stringify(good)}\nEnjoy`, ids)).toEqual(good)
  })

  it('drops a recommended slot id the model invented', () => {
    const brief = parseBrief(JSON.stringify({ ...good, recommendedSlotId: 'made-up' }), ids)
    expect(brief.recommendedSlotId).toBeNull()
  })

  it('truncates overlong fields instead of rejecting a usable brief', () => {
    const long = {
      ...good,
      summary: 'x'.repeat(900),
      bullets: Array.from({ length: 9 }, () => 'y'.repeat(300)),
      warnings: ['z'.repeat(300)],
    }
    const brief = parseBrief(JSON.stringify(long), ids)
    expect(brief.summary.length).toBeLessThanOrEqual(600)
    expect(brief.bullets).toHaveLength(6)
    expect(brief.bullets[0].length).toBeLessThanOrEqual(220)
    expect(brief.warnings[0].length).toBeLessThanOrEqual(220)
  })

  it('rejects malformed output with a user-facing error', () => {
    expect(() => parseBrief('no json here', ids)).toThrow(UserFacingError)
    expect(() => parseBrief('{"headline": 3}', ids)).toThrow(UserFacingError)
  })
})

describe('buildBriefContext', () => {
  it('tallies votes per slot, sorts by time, and includes stop hours', () => {
    const slots: Array<Envelope<Slot>> = [
      { recordId: 's2', data: { rideId: 'ride1', startsAt: Date.UTC(2026, 10, 22, 17) } },
      { recordId: 's1', data: { rideId: 'ride1', startsAt: Date.UTC(2026, 10, 21, 17) } },
    ]
    const votes: Array<Envelope<Vote>> = [
      { recordId: 'v1', data: { rideId: 'ride1', slotId: 's1', userId: 'a', choice: 'yes' } },
      { recordId: 'v2', data: { rideId: 'ride1', slotId: 's1', userId: 'b', choice: 'maybe' } },
      { recordId: 'v3', data: { rideId: 'ride1', slotId: 's2', userId: 'a', choice: 'no' } },
    ]
    const ctx = buildBriefContext(ride, slots, votes, 2)
    expect(ctx.slots.map((s) => s.slotId)).toEqual(['s1', 's2'])
    expect(ctx.slots[0].votes).toEqual({ yes: 1, maybe: 1, no: 0 })
    expect(ctx.slots[0].weekday).toBe('saturday')
    expect(ctx.slots[0].startsLocal).toContain('9:00')
    expect(ctx.stop?.hours).toEqual({ saturday: '8:30 AM–5 PM' })
    expect(ctx.ride.ridersGoing).toBe(2)
  })
})

/**
 * In-memory Store: `where` is exact-match like the RecordRoom, and creates
 * honour `uniqueOn` for the collections that declare one.
 */
const UNIQUE: Record<string, string[]> = { reminders: ['rideId', 'riderId', 'startsAt', 'attempt'] }

function memoryStore(seed: Record<string, Array<Envelope<unknown>>>, caller = 'system') {
  const db: Record<string, Array<Envelope<Record<string, unknown>>>> = {}
  for (const [c, rows] of Object.entries(seed)) {
    db[c] = rows.map((r) => ({ ...r, data: { ...(r.data as Record<string, unknown>) } }))
  }
  const rows = (c: string) => (db[c] ??= [])
  let n = 0
  const integration = vi.fn(async (_endpoint: string, _body: Record<string, unknown>): Promise<unknown> => ({}))
  const store: Store = {
    async query<T>(c: string, where: Record<string, unknown> = {}) {
      return rows(c).filter((r) => Object.entries(where).every(([k, v]) => r.data[k] === v)) as unknown as Array<
        Envelope<T>
      >
    },
    async get<T>(c: string, id: string) {
      return (rows(c).find((r) => r.recordId === id) ?? null) as Envelope<T> | null
    },
    async create(c, data) {
      const keys = UNIQUE[c]
      if (keys && rows(c).some((r) => keys.every((k) => r.data[k] === data[k]))) {
        throw new DuplicateRecordError(`Duplicate: ${c}`)
      }
      const recordId = `${c}-${++n}`
      rows(c).push({ recordId, createdBy: caller, data: { ...data } })
      return recordId
    },
    async update(c, id, patch) {
      const r = rows(c).find((x) => x.recordId === id)
      if (!r) throw new Error(`no ${c}/${id}`)
      Object.assign(r.data, patch)
    },
    async remove(c, id) {
      db[c] = rows(c).filter((r) => r.recordId !== id)
    },
    integration,
  }
  return { store, db, integration }
}

const users = ['alice', 'bob', 'cara'].map((id) => ({ recordId: id, data: { email: `${id}@example.com` } }))

describe('slots', () => {
  const now = Date.UTC(2026, 10, 20, 12)
  const later = now + 2 * 24 * 3600_000

  it('adds a time to an unlocked ride and dedupes the same time', async () => {
    const { store, db } = memoryStore({ rides: [ride] }, 'alice')
    const a = await addSlot(store, 'ride1', later, now)
    const b = await addSlot(store, 'ride1', later, now)
    expect(a.created).toBe(true)
    expect(b).toEqual({ slotId: a.slotId, created: false })
    expect(db.slots).toHaveLength(1)
  })

  it('refuses unknown rides, locked rides, past times and too many slots', async () => {
    const lockedRide = { ...ride, recordId: 'ride2', data: { ...ride.data, status: 'locked' as const } }
    const { store } = memoryStore({ rides: [ride, lockedRide] })
    await expect(addSlot(store, 'nope', later, now)).rejects.toThrow(UserFacingError)
    await expect(addSlot(store, 'ride2', later, now)).rejects.toThrow(/locked/)
    await expect(addSlot(store, 'ride1', now - 1, now)).rejects.toThrow(/future/)
    await expect(addSlot(store, 'ride1', NaN, now)).rejects.toThrow(/future/)
    for (let i = 0; i < MAX_SLOTS_PER_RIDE; i++) await addSlot(store, 'ride1', later + i * 3600_000, now)
    await expect(addSlot(store, 'ride1', later + 99 * 3600_000, now)).rejects.toThrow(/at most/)
  })

  it('lets the proposer or organizer remove a time with its votes, never once locked', async () => {
    const slot = { recordId: 's1', createdBy: 'alice', data: { rideId: 'ride1', startsAt: later } }
    const vote = { recordId: 'v1', data: { rideId: 'ride1', slotId: 's1', userId: 'bob', choice: 'yes' } }
    const { store, db } = memoryStore({ rides: [ride], slots: [slot], votes: [vote] })

    await expect(removeSlot(store, 'bob', 's1')).rejects.toThrow(/Only whoever proposed/)
    await lockSlot(store, 'org', 'ride1', 's1')
    await expect(removeSlot(store, 'alice', 's1')).rejects.toThrow(/Unlock/)
    await expect(removeSlot(store, 'org', 's1')).rejects.toThrow(/Unlock/)
    expect(db.slots).toHaveLength(1)

    await lockSlot(store, 'org', 'ride1', null)
    await removeSlot(store, 'org', 's1')
    expect(db.slots).toHaveLength(0)
    expect(db.votes).toHaveLength(0)
  })
})

describe('reminders', () => {
  const now = Date.UTC(2026, 10, 20, 12)
  const startsAt = now + 10 * 3600_000
  const lockedRide = (over: Partial<Ride> = {}): Envelope<Ride> => ({
    ...ride,
    data: { ...ride.data, status: 'locked', lockedStartsAt: startsAt, ...over },
  })
  const rsvp = (userId: string, status: Rsvp['status'] = 'going'): Envelope<Rsvp> => ({
    recordId: `rsvp-${userId}`,
    data: { rideId: 'ride1', userId, status },
  })
  const sentTo = (integration: ReturnType<typeof memoryStore>['integration']) =>
    integration.mock.calls.map((c) => (c[1] as { to: string }).to)

  it('emails only "going" riders for rides starting within 24h, once', async () => {
    const { store, db, integration } = memoryStore({
      rides: [lockedRide()],
      rsvps: [rsvp('alice'), rsvp('bob', 'out')],
      users,
    })
    expect((await sendDueReminders(store, 'https://x', now)).sent).toBe(1)
    expect(sentTo(integration)).toEqual(['alice@example.com'])
    expect(db.rides[0].data.reminderSentAt).toBe(now)

    expect((await sendDueReminders(store, 'https://x', now + 30 * 60_000)).sent).toBe(0)
    expect(integration).toHaveBeenCalledTimes(1)
  })

  it('skips rides too far out or in the past', async () => {
    const { store, integration } = memoryStore({
      rides: [
        lockedRide({ lockedStartsAt: now + 3 * 24 * 3600_000 }),
        { ...lockedRide({ lockedStartsAt: now - 3600_000 }), recordId: 'ride2' },
      ],
      rsvps: [rsvp('alice')],
      users,
    })
    expect((await sendDueReminders(store, 'https://x', now)).sent).toBe(0)
    expect(integration).not.toHaveBeenCalled()
  })

  it('retries a failed send on the next run without re-emailing riders who got it', async () => {
    const { store, db, integration } = memoryStore({
      rides: [lockedRide()],
      rsvps: [rsvp('alice'), rsvp('bob')],
      users,
    })
    integration.mockImplementation(async (_e, body) => {
      if (body.to === 'bob@example.com') throw new Error('smtp 451')
      return {}
    })
    expect(await sendReminderForRide(store, db.rides[0] as unknown as Envelope<Ride>, 'https://x', now)).toEqual({
      sent: 1,
      failed: 1,
      pending: 2,
    })

    integration.mockImplementation(async () => ({}))
    expect((await sendDueReminders(store, 'https://x', now + 30 * 60_000)).sent).toBe(1)
    expect(sentTo(integration)).toEqual(['alice@example.com', 'bob@example.com', 'bob@example.com'])
    const bob = (db.reminders as unknown as Array<Envelope<Reminder>>).filter((r) => r.data.riderId === 'bob')
    expect(bob.map((r) => r.data.status)).toEqual(['failed', 'sent'])
  })

  it('stops retrying a rider after the attempt limit', async () => {
    const { store, integration } = memoryStore({ rides: [lockedRide()], rsvps: [rsvp('alice')], users })
    integration.mockImplementation(async () => {
      throw new Error('down')
    })
    for (let i = 0; i < REMINDER_MAX_ATTEMPTS + 3; i++) await sendDueReminders(store, 'https://x', now + i * 60_000)
    expect(integration).toHaveBeenCalledTimes(REMINDER_MAX_ATTEMPTS)
  })

  it('reminds a rider who RSVPs after the first run, and nobody when no one is going yet', async () => {
    const { store, db, integration } = memoryStore({ rides: [lockedRide()], rsvps: [], users })
    expect((await sendDueReminders(store, 'https://x', now)).sent).toBe(0)
    expect(db.rides[0].data.reminderSentAt).toBeUndefined()

    db.rsvps.push(rsvp('cara') as unknown as Envelope<Record<string, unknown>>)
    expect((await sendDueReminders(store, 'https://x', now + 30 * 60_000)).sent).toBe(1)
    expect(sentTo(integration)).toEqual(['cara@example.com'])
  })

  it("leaves another run's fresh claim alone but takes over a stale one", async () => {
    const claim = (claimedAt: number): Envelope<Reminder> => ({
      recordId: 'claim',
      data: { rideId: 'ride1', riderId: 'alice', startsAt, attempt: 1, status: 'sending', claimedAt },
    })
    const fresh = memoryStore({ rides: [lockedRide()], rsvps: [rsvp('alice')], users, reminders: [claim(now)] })
    expect((await sendDueReminders(fresh.store, 'https://x', now + 60_000)).sent).toBe(0)

    const stale = memoryStore({
      rides: [lockedRide()],
      rsvps: [rsvp('alice')],
      users,
      reminders: [claim(now - REMINDER_CLAIM_TTL - 1)],
    })
    expect((await sendDueReminders(stale.store, 'https://x', now)).sent).toBe(1)
  })

  it('sends again when the ride is re-locked to a different time', async () => {
    const { store, db, integration } = memoryStore({ rides: [lockedRide()], rsvps: [rsvp('alice')], users })
    await sendDueReminders(store, 'https://x', now)
    db.rides[0].data.lockedStartsAt = startsAt + 3600_000
    await sendDueReminders(store, 'https://x', now)
    expect(integration).toHaveBeenCalledTimes(2)
  })
})

describe('collectPages', () => {
  it('follows nextOffset past the first page until it runs out', async () => {
    const all = Array.from({ length: 1234 }, (_, i) => ({ recordId: `r${i}`, data: {} }))
    const offsets: number[] = []
    const got = await collectPages(async (offset) => {
      offsets.push(offset)
      const records = all.slice(offset, offset + 500)
      return { records, nextOffset: offset + 500 < all.length ? offset + 500 : undefined }
    })
    expect(got).toHaveLength(1234)
    expect(offsets).toEqual([0, 500, 1000])
  })

  it('stops on a non-advancing offset instead of looping forever', async () => {
    const got = await collectPages(async () => ({ records: [{ recordId: 'a', data: {} }], nextOffset: 0 }))
    expect(got).toHaveLength(1)
  })
})
