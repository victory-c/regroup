import { useState } from 'react'
import { useMutations } from 'deepspace'
import { Coffee, ExternalLink, Search, Star } from 'lucide-react'
import { Button, Input } from '../ui'
import type { Ride, StopOption } from '../../lib/types'
import { cn } from '../../lib/utils'

interface Props {
  rideId: string
  ride: Ride
  isOrganizer: boolean
  /** Weekday (lowercase) of the locked or recommended slot, to show that day's hours. */
  dayKey?: string
  searching: boolean
  onSearch: (q: string) => void
}

export function StopPanel({ rideId, ride, isOrganizer, dayKey, searching, onSearch }: Props) {
  const { ready, put } = useMutations<Ride>('rides')
  const [q, setQ] = useState(ride.stopQuery ?? 'coffee')
  const options = ride.stopOptions ?? []
  const chosen = ride.chosenStopIndex != null ? options[ride.chosenStopIndex] : undefined

  const visible: Array<{ o: StopOption; i: number }> = isOrganizer
    ? options.map((o, i) => ({ o, i }))
    : chosen
      ? [{ o: chosen, i: ride.chosenStopIndex! }]
      : []

  return (
    <section aria-labelledby="stop-heading" className="rounded-lg border border-border bg-card p-4">
      <h2 id="stop-heading" className="mb-3 flex items-center gap-1.5 font-display text-xl font-bold uppercase tracking-wide">
        <Coffee aria-hidden className="size-4 text-primary" />
        Regroup stop
      </h2>

      {isOrganizer && (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch(q)
          }}
        >
          <Input
            aria-label="What kind of stop"
            value={q}
            maxLength={80}
            onChange={(e) => setQ(e.target.value)}
            placeholder="coffee, bakery, bike shop…"
            className="h-9"
          />
          <Button type="submit" size="sm" variant="outline" loading={searching} disabled={!q.trim()}>
            {!searching && <Search aria-hidden />}
            Search
          </Button>
        </form>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isOrganizer
            ? `Search near ${ride.startArea.split(',')[0]} and pick a spot — the brief checks its hours against the ride.`
            : 'No stop picked yet.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map(({ o, i }) => {
            const isChosen = ride.chosenStopIndex === i
            const todays = dayKey && o.hours ? o.hours[dayKey] : undefined
            return (
              <li
                key={`${o.name}-${i}`}
                className={cn(
                  'rounded-md border p-2.5 text-sm',
                  isChosen ? 'border-primary bg-accent' : 'border-border',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight">{o.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[o.type, o.address].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {o.rating != null && (
                        <span className="inline-flex items-center gap-0.5">
                          <Star aria-hidden className="size-3 fill-current text-[#d69e2e]" />
                          {o.rating} ({o.reviews ?? 0})
                        </span>
                      )}
                      {dayKey && (
                        <span>
                          {dayKey[0].toUpperCase() + dayKey.slice(1, 3)}: {todays ?? 'hours unknown'}
                        </span>
                      )}
                      {o.mapsUrl && (
                        <a
                          href={o.mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 text-primary hover:underline"
                        >
                          Map <ExternalLink aria-hidden className="size-3" />
                        </a>
                      )}
                    </p>
                  </div>
                  {isOrganizer && (
                    <Button
                      size="sm"
                      variant={isChosen ? 'default' : 'ghost'}
                      disabled={!ready}
                      aria-pressed={isChosen}
                      onClick={() => put(rideId, { chosenStopIndex: isChosen ? null : i } as Partial<Ride>)}
                    >
                      {isChosen ? 'Picked' : 'Pick'}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
