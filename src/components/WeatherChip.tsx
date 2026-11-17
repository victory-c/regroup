import { CloudOff, CloudRain, CloudSun, Snowflake, Sun, Thermometer } from 'lucide-react'
import type { SlotWeather } from '../lib/types'
import { cn } from '../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui'

const TONE: Record<string, string> = {
  Great: 'bg-[#e3f1e4] text-[#1f5f2a] border-[#bfdcc3]',
  Good: 'bg-[#eef3df] text-[#4b5d16] border-[#d6e2b3]',
  Iffy: 'bg-[#fbefd6] text-[#7a5207] border-[#efd6a0]',
  Rough: 'bg-[#f9e1dc] text-[#8f2414] border-[#efbcb2]',
}

function Icon({ description }: { description: string }) {
  const d = description.toLowerCase()
  if (d.includes('snow')) return <Snowflake aria-hidden className="size-3.5" />
  if (d.includes('rain') || d.includes('drizzle') || d.includes('thunder'))
    return <CloudRain aria-hidden className="size-3.5" />
  if (d.includes('clear')) return <Sun aria-hidden className="size-3.5" />
  return <CloudSun aria-hidden className="size-3.5" />
}

export function WeatherChip({ weather, pending }: { weather?: SlotWeather; pending?: boolean }) {
  if (!weather) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
        <Thermometer aria-hidden className="size-3.5" />
        {pending ? 'Checking forecast…' : 'No forecast yet'}
      </span>
    )
  }
  if (weather.status === 'out_of_range') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
        title={weather.reason}
      >
        <CloudOff aria-hidden className="size-3.5" />
        {weather.reason}
      </span>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-testid="weather-chip"
            className={cn(
              'inline-flex cursor-default items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium',
              TONE[weather.label],
            )}
          >
            <Icon description={weather.description} />
            <span className="font-semibold">{weather.label}</span>
            <span className="tabular-nums opacity-80">
              {weather.tempF}°F · {weather.reasons.join(', ')}
            </span>
          </span>
        }
      />
      <TooltipContent>
        Score {weather.score}/100 · worst conditions in the ride window: {weather.description}, feels
        like {weather.feelsF}°F. No wind data in this forecast.
      </TooltipContent>
    </Tooltip>
  )
}
