/**
 * Regroup collections: rides, the time slots proposed for them, per-rider
 * votes on those slots, and RSVPs once the organizer locks a slot.
 *
 * Security notes (all enforced in the RecordRoom DO, not the UI):
 * - Anything computed by the server (weather, AI brief, stop search results,
 *   reminder bookkeeping) is excluded from `writableFields`, so a client can't
 *   forge it. Server actions write those fields with RBAC bypassed.
 * - Votes and RSVPs are one-per-user via `uniqueOn` + a `userBound` owner
 *   column, so a forged client write can't stuff the ballot or vote as
 *   someone else.
 */

import type { CollectionSchema } from 'deepspace/schema'

const RIDE_CLIENT_FIELDS = [
  'title',
  'notes',
  'startArea',
  'weatherQuery',
  'timezone',
  'durationHours',
  'distanceMi',
  'pace',
  'chosenStopIndex',
]

export const ridesSchema: CollectionSchema = {
  name: 'rides',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'notes', storage: 'text', interpretation: 'plain' },
    /** Human label for the meeting area, e.g. "Berkeley, California, US". */
    { name: 'startArea', storage: 'text', interpretation: 'plain', required: true },
    /** OpenWeatherMap city query resolved from geocoding, e.g. "Berkeley,CA,US". */
    { name: 'weatherQuery', storage: 'text', interpretation: 'plain', required: true },
    /** Organizer's IANA timezone, used to format times for the AI brief and emails. */
    { name: 'timezone', storage: 'text', interpretation: 'plain' },
    { name: 'durationHours', storage: 'number', interpretation: 'plain' },
    { name: 'distanceMi', storage: 'number', interpretation: 'plain' },
    {
      name: 'pace',
      storage: 'text',
      interpretation: { kind: 'select', options: ['social', 'steady', 'spirited', 'race'] },
    },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['planning', 'locked', 'cancelled'] },
      default: 'planning',
    },
    { name: 'chosenStopIndex', storage: 'number', interpretation: 'plain' },
    // ── server-owned ────────────────────────────────────────────────────
    // Locking goes through the `lockSlot` action so lockedStartsAt always
    // matches a real slot and the reminder bookkeeping resets with it.
    { name: 'lockedSlotId', storage: 'text', interpretation: 'plain' },
    { name: 'lockedStartsAt', storage: 'number', interpretation: 'plain' },
    { name: 'stopOptions', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'stopQuery', storage: 'text', interpretation: 'plain' },
    { name: 'briefing', storage: 'text', interpretation: { kind: 'json' } },
    /** Last forecast fetched for this ride: { fetchedAt, entries }. */
    { name: 'forecastCache', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'reminderSentAt', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    member: {
      read: true,
      create: true,
      update: 'own',
      delete: 'own',
      writableFields: RIDE_CLIENT_FIELDS,
    },
    admin: {
      read: true,
      create: true,
      update: true,
      delete: true,
      writableFields: RIDE_CLIENT_FIELDS,
    },
  },
}

export const slotsSchema: CollectionSchema = {
  name: 'slots',
  columns: [
    { name: 'rideId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    /** Epoch milliseconds. */
    { name: 'startsAt', storage: 'number', interpretation: 'plain', required: true },
    // ── server-owned ────────────────────────────────────────────────────
    { name: 'weather', storage: 'text', interpretation: { kind: 'json' } },
  ],
  permissions: {
    member: {
      read: true,
      create: true,
      update: 'own',
      delete: 'own',
      writableFields: ['rideId', 'startsAt'],
    },
    admin: {
      read: true,
      create: true,
      update: true,
      delete: true,
      writableFields: ['rideId', 'startsAt'],
    },
  },
}

export const votesSchema: CollectionSchema = {
  name: 'votes',
  columns: [
    { name: 'rideId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'slotId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    {
      name: 'choice',
      storage: 'text',
      interpretation: { kind: 'select', options: ['yes', 'maybe', 'no'] },
      required: true,
    },
  ],
  uniqueOn: ['slotId', 'userId'],
  ownerField: 'userId',
  permissions: {
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: 'own', delete: true },
  },
}

export const rsvpsSchema: CollectionSchema = {
  name: 'rsvps',
  columns: [
    { name: 'rideId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['going', 'out'] },
      required: true,
    },
  ],
  uniqueOn: ['rideId', 'userId'],
  ownerField: 'userId',
  permissions: {
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: 'own', delete: true },
  },
}
