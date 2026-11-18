import { describe, expect, it } from 'vitest'
import { briefBasis, isBriefStale } from './brief-basis'
import type { Briefing, Ride, Rsvp, Slot, Vote } from './types'

const ride: Ride = { title: 'Loop', startArea: 'Berkeley', weatherQuery: 'Berkeley,CA,US', status: 'planning' }
const slots = [
  { recordId: 's1', data: { rideId: 'r', startsAt: 1 } as Slot },
  { recordId: 's2', data: { rideId: 'r', startsAt: 2 } as Slot },
]
const votes = [{ recordId: 'v1', data: { rideId: 'r', slotId: 's1', userId: 'a', choice: 'yes' } as Vote }]
const rsvps: Array<{ recordId: string; data: Rsvp }> = []
const base = briefBasis(ride, slots, votes, rsvps)
const brief = (basis?: string): Briefing => ({
  recommendedSlotId: null,
  headline: 'h',
  summary: 's',
  bullets: [],
  warnings: [],
  generatedAt: 0,
  model: 'm',
  basis,
})

describe('briefBasis', () => {
  it('ignores record order and weather', () => {
    const reordered = [...slots].reverse().map((s) => ({ ...s, data: { ...s.data, weather: undefined } }))
    expect(briefBasis(ride, reordered, votes, rsvps)).toBe(base)
  })

  it('changes when the lock, a vote, an RSVP, a slot or the stop changes', () => {
    const changed = [
      briefBasis({ ...ride, status: 'locked', lockedSlotId: 's1' }, slots, votes, rsvps),
      briefBasis(ride, slots, [{ ...votes[0], data: { ...votes[0].data, choice: 'no' } }], rsvps),
      briefBasis(ride, slots, votes, [{ recordId: 'x', data: { rideId: 'r', userId: 'a', status: 'going' } }]),
      briefBasis(ride, slots.slice(1), votes, rsvps),
      briefBasis({ ...ride, chosenStopIndex: 0, stopOptions: [{ name: 'Cafe' }] }, slots, votes, rsvps),
    ]
    for (const c of changed) expect(c).not.toBe(base)
  })

  it('an "out" RSVP does not change who is going', () => {
    expect(briefBasis(ride, slots, votes, [{ recordId: 'x', data: { rideId: 'r', userId: 'a', status: 'out' } }])).toBe(
      base,
    )
  })
})

describe('isBriefStale', () => {
  it('is false with no brief, false when it matches, true otherwise', () => {
    expect(isBriefStale(undefined, base)).toBe(false)
    expect(isBriefStale(brief(base), base)).toBe(false)
    expect(isBriefStale(brief('00000000'), base)).toBe(true)
    expect(isBriefStale(brief(undefined), base)).toBe(true)
  })
})
