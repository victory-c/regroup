import { describe, expect, it, vi } from 'vitest'
import {
  buildBriefContext,
  parseBrief,
  sendDueReminders,
  UserFacingError,
  type Envelope,
  type Store,
} from './ride-ops'
import type { Ride, Rsvp, Slot, Vote } from '../lib/types'

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

describe('sendDueReminders', () => {
  const now = Date.UTC(2026, 10, 20, 12)

  function makeStore(rides: Array<Envelope<Ride>>, rsvps: Array<Envelope<Rsvp>>) {
    const updates: Array<[string, string, Record<string, unknown>]> = []
    const integration = vi.fn(async () => ({}))
    const store: Store = {
      async query<T>(collection: string) {
        return (collection === 'rides' ? rides : rsvps) as unknown as Array<Envelope<T>>
      },
      async get<T>(_c: string, id: string) {
        return { recordId: id, data: { email: `${id}@example.com` } } as unknown as Envelope<T>
      },
      async update(c, id, patch) {
        updates.push([c, id, patch])
      },
      integration,
    }
    return { store, updates, integration }
  }

  const locked = (over: Partial<Ride>): Envelope<Ride> => ({
    ...ride,
    data: { ...ride.data, status: 'locked', ...over },
  })
  const going: Array<Envelope<Rsvp>> = [
    { recordId: 'r1', data: { rideId: 'ride1', userId: 'alice', status: 'going' } },
    { recordId: 'r2', data: { rideId: 'ride1', userId: 'bob', status: 'out' } },
  ]

  it('emails only "going" riders for rides starting within 24h, once', async () => {
    const { store, updates, integration } = makeStore(
      [locked({ lockedStartsAt: now + 10 * 3600_000 })],
      going,
    )
    const { sent } = await sendDueReminders(store, 'https://regroup.app.space', now)
    expect(sent).toBe(1)
    expect(integration).toHaveBeenCalledTimes(1)
    expect(integration.mock.calls[0]).toMatchObject(['email/send', { to: 'alice@example.com' }])
    expect(updates).toContainEqual(['rides', 'ride1', { reminderSentAt: now }])
  })

  it('skips rides already reminded, too far out, or in the past', async () => {
    const { store, integration } = makeStore(
      [
        locked({ lockedStartsAt: now + 3600_000, reminderSentAt: now - 1000 }),
        locked({ lockedStartsAt: now + 3 * 24 * 3600_000 }),
        locked({ lockedStartsAt: now - 3600_000 }),
      ],
      going,
    )
    expect((await sendDueReminders(store, 'https://x', now)).sent).toBe(0)
    expect(integration).not.toHaveBeenCalled()
  })
})
