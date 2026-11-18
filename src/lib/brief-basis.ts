/**
 * What a ride brief was written from, reduced to a short fingerprint, so the
 * server (reminder emails) and the ride page can both tell when the brief no
 * longer matches the ride.
 *
 * Covered: the ride details the brief reads, lock state, the chosen stop, the
 * slots, every vote, and who is going. Not covered: weather. Slots are
 * re-scored every 30 minutes, so including it would mark every brief stale
 * within the hour; a brief is advice about the plan, and the slot chips show
 * the live forecast.
 */

import type { Briefing, Ride, Rsvp, Slot, Vote } from './types'

type Rec<T> = { recordId: string; data: T }

export function briefBasis(
  ride: Ride,
  slots: Array<Rec<Slot>>,
  votes: Array<Rec<Vote>>,
  rsvps: Array<Rec<Rsvp>>,
): string {
  const stop = ride.chosenStopIndex != null ? ride.stopOptions?.[ride.chosenStopIndex]?.name : undefined
  const parts = [
    ride.title,
    ride.notes ?? '',
    ride.startArea,
    String(ride.durationHours ?? ''),
    String(ride.distanceMi ?? ''),
    ride.pace ?? '',
    ride.status ?? 'planning',
    ride.lockedSlotId ?? '',
    stop ?? '',
    slots
      .map((s) => `${s.recordId}@${s.data.startsAt}`)
      .sort()
      .join(','),
    votes
      .map((v) => `${v.data.slotId}:${v.data.userId ?? ''}:${v.data.choice}`)
      .sort()
      .join(','),
    rsvps
      .filter((r) => r.data.status === 'going')
      .map((r) => r.data.userId ?? '')
      .sort()
      .join(','),
  ]
  return fnv1a(parts.join('\u0000'))
}

/** True when the brief predates the ride's current state (or can't be checked). */
export function isBriefStale(briefing: Briefing | undefined, basis: string): boolean {
  if (!briefing) return false
  // Briefs written before fingerprints existed can't be vouched for.
  return briefing.basis !== basis
}

/** 32-bit FNV-1a, hex. Not for security: only to keep the stored key short. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
