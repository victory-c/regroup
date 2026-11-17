import { CloudOff, Thermometer } from 'lucide-react'
import type { SlotWeather, WeatherLabel } from '../lib/types'
import { cn } from '../lib/utils'

const DOT: Record<WeatherLabel, string> = {
  Great: 'bg-weather-great',
  Good: 'bg-weather-good',
  Iffy: 'bg-weather-iffy',
  Rough: 'bg-weather-rough',
}

/** One-line weather verdict: a status dot, the label, temp and the reasons. */
export function WeatherChip({ weather, pending }: { weather?: SlotWeather; pending?: boolean }) {
  if (!weather) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Thermometer aria-hidden className="size-4" />
        {pending ? 'Checking the forecast' : 'No forecast yet'}
      </span>
    )
  }
  if (weather.status === 'out_of_range') {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <CloudOff aria-hidden className="size-4" />
        {weather.reason}
      </span>
    )
  }
  return (
    <span
      data-testid="weather-chip"
      title={`Score ${weather.score}/100. Worst conditions in the ride window: ${weather.description}, feels like ${weather.feelsF}°F. This forecast has no wind data.`}
      className="inline-flex min-w-0 items-center gap-2 text-sm"
    >
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[weather.label])} />
      <span className="font-semibold text-foreground">{weather.label}</span>
      <span className="truncate text-muted-foreground tabular-nums">
        {weather.tempF}°F, {weather.reasons.join(', ')}
      </span>
    </span>
  )
}
