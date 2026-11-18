/** Row shapes shared by the React pages and the worker (actions, cron). */

export type Pace = 'social' | 'steady' | 'spirited' | 'race'
export type RideStatus = 'planning' | 'locked' | 'cancelled'
export type VoteChoice = 'yes' | 'maybe' | 'no'

export interface StopOption {
  name: string
  address?: string
  rating?: number
  reviews?: number
  type?: string
  /** Day name (lowercase) → hours string, as Google Maps reports them. */
  hours?: Record<string, string>
  mapsUrl?: string
}

export interface Briefing {
  recommendedSlotId: string | null
  headline: string
  summary: string
  bullets: string[]
  warnings: string[]
  generatedAt: number
  model: string
}

export interface Ride {
  title: string
  notes?: string
  startArea: string
  weatherQuery: string
  timezone?: string
  durationHours?: number
  distanceMi?: number
  pace?: Pace
  status?: RideStatus
  lockedSlotId?: string
  lockedStartsAt?: number
  chosenStopIndex?: number
  stopOptions?: StopOption[]
  stopQuery?: string
  briefing?: Briefing
  forecastCache?: { fetchedAt: number; entries: unknown[] }
  reminderSentAt?: number
}

export type WeatherLabel = 'Great' | 'Good' | 'Iffy' | 'Rough'

export type SlotWeather =
  | {
      status: 'ok'
      score: number
      label: WeatherLabel
      tempF: number
      feelsF: number
      description: string
      icon: string
      reasons: string[]
      fetchedAt: number
    }
  | { status: 'out_of_range'; reason: string; fetchedAt: number }

export interface Slot {
  rideId: string
  startsAt: number
  weather?: SlotWeather
}

export interface Vote {
  rideId: string
  slotId: string
  userId?: string
  choice: VoteChoice
}

export interface Rsvp {
  rideId: string
  userId?: string
  status: 'going' | 'out'
  /** The locked start time this answer applies to (server-set). */
  startsAt?: number
}

/** One reminder send attempt for one rider at one locked ride time (server-only). */
export interface Reminder {
  rideId: string
  riderId: string
  startsAt: number
  attempt: number
  status: 'sending' | 'sent' | 'failed'
  claimedAt: number
  error?: string
}
