/**
 * The forecast strip: the 3-hour forecast buckets around one slot, with the
 * ride window bracketed in the accent. It's the reason behind a slot's score
 * made visible ("8am is Iffy because the 9am bucket is rain at 41°F").
 *
 * Data is the forecast the server already cached on the ride
 * (ride.forecastCache), so this costs no extra integration calls.
 */

import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Moon, Snowflake, Sun } from 'lucide-react'
import type { ForecastEntry } from '../lib/weather'
import { cn } from '../lib/utils'

const HOUR = 3600_000
const STEP = 3 * HOUR

function ConditionIcon({ entry }: { entry: ForecastEntry }) {
  const d = entry.description.toLowerCase()
  const night = entry.icon.endsWith('n')
  const cls = 'size-4'
  if (d.includes('thunder')) return <CloudLightning aria-hidden className={cls} />
  if (d.includes('snow') || d.includes('sleet')) return <Snowflake aria-hidden className={cls} />
  if (d.includes('drizzle') || d.includes('light rain')) return <CloudDrizzle aria-hidden className={cls} />
  if (d.includes('rain') || d.includes('shower')) return <CloudRain aria-hidden className={cls} />
  if (d.includes('fog') || d.includes('mist') || d.includes('haze')) return <CloudFog aria-hidden className={cls} />
  if (d.includes('clear')) return night ? <Moon aria-hidden className={cls} /> : <Sun aria-hidden className={cls} />
  if (d.includes('few') || d.includes('scattered')) return <CloudSun aria-hidden className={cls} />
  return <Cloud aria-hidden className={cls} />
}

function hourLabel(ms: number, timeZone?: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone })
    .format(new Date(ms))
    .replace(/\s?([AP])M/i, (_m, p: string) => p.toLowerCase())
}

function isWet(e: ForecastEntry) {
  return /rain|drizzle|shower|thunder|snow|sleet/i.test(e.description)
}

interface Props {
  entries?: unknown[]
  startsAt: number
  durationHours: number
  className?: string
  /** Pin the clock labels (the static landing prerenders on the server). */
  timeZone?: string
}

export function ForecastStrip({ entries, startsAt, durationHours, className, timeZone }: Props) {
  const all = (entries ?? []) as ForecastEntry[]
  const end = startsAt + Math.max(durationHours, 0.5) * HOUR
  // One bucket of context either side of the ride window.
  const shown = all.filter((e) => {
    const t = e.dt * 1000
    return t >= startsAt - STEP - HOUR && t <= end + STEP + HOUR
  })
  if (shown.length < 2) return null

  const first = shown[0].dt * 1000 - STEP / 2
  const span = shown.length * STEP
  const left = Math.max(0, ((startsAt - first) / span) * 100)
  const right = Math.min(100, ((end - first) / span) * 100)

  return (
    <figure
      className={cn('min-w-0', className)}
      aria-label={`Forecast around this ride: ${shown
        .map((e) => `${hourLabel(e.dt * 1000, timeZone)} ${Math.round(e.temp)} degrees, ${e.description}`)
        .join('; ')}`}
    >
      <div className="relative">
        {/* Ride window bracket */}
        <div
          aria-hidden
          className="absolute -top-1.5 h-1.5 rounded-t-sm border-x-2 border-t-2 border-primary"
          style={{ left: `${left}%`, width: `${Math.max(right - left, 4)}%` }}
        />
        <ol className="grid" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
          {shown.map((e) => {
            const t = e.dt * 1000
            const inRide = t + STEP / 2 > startsAt && t - STEP / 2 < end
            return (
              <li
                key={e.dt}
                className={cn(
                  'flex flex-col items-center gap-1 border-t border-border px-1 pt-2 text-xs tabular-nums',
                  inRide ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className={cn(isWet(e) && inRide && 'text-weather-rough')}>
                  <ConditionIcon entry={e} />
                </span>
                <span className="font-medium">{Math.round(e.temp)}°</span>
                <span className="text-muted-foreground">{hourLabel(t, timeZone)}</span>
              </li>
            )
          })}
        </ol>
      </div>
    </figure>
  )
}
