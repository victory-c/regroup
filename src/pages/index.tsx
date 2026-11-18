/**
 * Design Direction
 *
 * Product: Regroup helps a small cycling group pick a ride time everyone can make,
 *   scored against the forecast, with a coffee stop and a short ride brief.
 * Emotion: the calm of a captain who already checked the radar before the group chat woke up.
 * Metaphor: the forecast laid under the ride: the hours you'll be out, bracketed like a
 *   route on a cue sheet.
 * References: a cycling cue sheet taped to a top tube; a weather radar loop; road signage (DIN).
 * Signature: the forecast strip, 3-hour buckets with the ride window bracketed in ember orange.
 * Hero: a real ride being decided: three proposed times, live votes, the dry one recommended,
 *   laid over a faint group riding out of the morning fog.
 *
 * Style Tile
 * - Color: cool asphalt-grey neutrals, one ember-orange accent (hi-vis kit), low saturation.
 * - Type: Barlow for everything; DIN-like road-signage letterforms, clear at small sizes,
 *   sentence case, 400/500/600.
 * - Theme: light; it's checked on a phone the night before, often outdoors in the morning.
 * - Art direction: product-as-hero; the slot board rendered in code with plausible data. One
 *   atmospheric photo behind it (riders backlit in fog, soft focus), framed at the top and
 *   dissolving into the page colour so the card never competes with it.
 * - Motion: still; the only motion is the app responding to votes.
 * - Voice: plain verbs; specific about weather and time; never hype.
 *
 * Static page (no providers, no websocket), prerendered at build.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { ForecastStrip } from '../components/ForecastStrip'
import { WeatherChip } from '../components/WeatherChip'
import { RegroupMark } from '../components/Navigation'
import { seo } from '../seo'
import type { SlotWeather } from '../lib/types'
import { cn } from '../lib/utils'

// Sample ride, Berkeley, pinned to fixed instants so prerender and hydration agree.
const TZ = 'America/Los_Angeles'
const SUN_9 = Date.UTC(2026, 10, 22, 17) // Sun 9:00 AM PT
const H = 3600
const SAMPLE_FORECAST = [
  { off: -3, temp: 49, description: 'few clouds', icon: '02d' },
  { off: 0, temp: 54, description: 'few clouds', icon: '02d' },
  { off: 3, temp: 60, description: 'clear sky', icon: '01d' },
  { off: 6, temp: 61, description: 'scattered clouds', icon: '03d' },
].map((e) => ({ dt: SUN_9 / 1000 + e.off * H, temp: e.temp, feels_like: e.temp, humidity: 60, description: e.description, icon: e.icon }))

const w = (label: 'Great' | 'Iffy' | 'Rough', score: number, tempF: number, reasons: string[]): SlotWeather => ({
  status: 'ok',
  score,
  label,
  tempF,
  feelsF: tempF,
  description: reasons[0],
  icon: '',
  reasons,
  fetchedAt: 0,
})

const SLOTS = [
  { when: 'Sat, 8:00 AM', weather: w('Rough', 32, 51, ['heavy rain', 'chilly']), yes: 5, maybe: 1 },
  { when: 'Sat, 1:00 PM', weather: w('Iffy', 52, 55, ['light rain']), yes: 3, maybe: 2 },
  { when: 'Sun, 9:00 AM', weather: w('Great', 100, 54, ['dry, comfortable temps']), yes: 6, maybe: 1, pick: true },
]
const RIDERS = ['Maya', 'Jordan', 'Sam', 'Priya', 'Leo', 'Ana']

function SlotBoardPreview({ className }: { className?: string }) {
  return (
    <section
      aria-label="Example: a group voting on ride times"
      className={cn('rounded-2xl border border-border bg-card p-6 shadow-float', className)}
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xl font-semibold">Sunday hills, 35 mi</p>
        <p className="text-sm text-muted-foreground tabular-nums">7 riders</p>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">Berkeley, steady pace, 2 hours</p>

      <ol className="space-y-3">
        {SLOTS.map((s) => (
          <li
            key={s.when}
            className={cn('rounded-xl border p-4', s.pick ? 'border-primary' : 'border-border')}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-semibold tabular-nums">{s.when}</p>
              {s.pick ? (
                <span className="text-sm font-medium text-primary-ink">Recommended</span>
              ) : (
                <span className="text-sm tabular-nums text-muted-foreground">
                  {s.yes} in, {s.maybe} maybe
                </span>
              )}
            </div>
            <div className="mt-1">
              <WeatherChip weather={s.weather} />
            </div>
            {s.pick && (
              <>
                <ForecastStrip
                  className="mt-5"
                  entries={SAMPLE_FORECAST}
                  startsAt={SUN_9}
                  durationHours={2}
                  timeZone={TZ}
                />
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                  <ol className="flex items-center gap-1" aria-label={`${RIDERS.join(', ')} are in`}>
                    {RIDERS.map((r) => (
                      <li
                        key={r}
                        className="grid size-6 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-background"
                      >
                        {r[0]}
                      </li>
                    ))}
                  </ol>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    <span className="font-semibold text-foreground">{s.yes}</span> in, {s.maybe} maybe
                  </span>
                </div>
              </>
            )}
          </li>
        ))}
      </ol>

      <p className="mt-4 rounded-xl bg-secondary p-4 text-sm leading-relaxed">
        <span className="font-semibold">Brief:</span> Sunday 9am has the most riders and stays dry. The
        Hidden Cafe opens at 8:30, so the top-of-the-climb stop works. Bring a vest for the descent.
      </p>
    </section>
  )
}

function Header() {
  return (
    <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
      <span className="flex items-center gap-2 text-lg font-semibold">
        <RegroupMark />
        Regroup
      </span>
      <Link to="/home" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        Open the ride board
      </Link>
    </header>
  )
}

function Pitch({ className }: { className?: string }) {
  return (
    <section className={className}>
      <h1 className="text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-6xl">
        <span className="block">Pick the ride time.</span>
        <span className="block">Beat the rain.</span>
      </h1>
      <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
        Propose a few start times and your group votes live. Every option is scored on the forecast for the
        whole ride, and a short brief picks the winner and checks the coffee stop is open.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Link
          to="/home"
          className="inline-flex h-12 items-center rounded-lg bg-primary px-6 font-medium text-primary-foreground transition-colors hover:bg-primary-ink"
        >
          Plan a ride
        </Link>
        <span className="text-sm text-muted-foreground">Free, sign in with Google or GitHub</span>
      </div>
    </section>
  )
}

/** The photo is framed at the top and fades to the page colour through its lower part (a mask,
 *  not an overlay), so the slot board stepping over it sits on clean background: no hard frame
 *  edge behind the card and no busy photo detail next to its lower-left corner. The riders stay
 *  in the upper right, clear of the card. */
function Hero() {
  return (
    <main className="relative mx-auto max-w-6xl px-4 pb-24 pt-2 sm:px-6">
      <div className="relative overflow-hidden rounded-t-3xl">
        <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,black_62%,transparent_98%)]">
          <img
            src="/hero/treeline.webp"
            alt=""
            className="h-full w-full object-cover object-[78%_45%] sm:object-[70%_45%]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background from-10% via-background/70 via-40% to-transparent to-65% max-sm:via-background/80 max-sm:to-background/40 max-sm:to-100%" />
        </div>
        <div className="relative px-6 pb-56 pt-14 sm:px-10 lg:pb-80 lg:pt-20">
          <Pitch />
        </div>
      </div>
      <SlotBoardPreview className="relative mx-2 -mt-40 max-w-xl sm:mx-10 lg:-mt-60" />
    </main>
  )
}

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <Header />
        <Hero />

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-6 py-6 text-sm text-muted-foreground">
            <span>Built on DeepSpace</span>
            <span>Forecasts from OpenWeatherMap, places from Google Maps, briefs written by Claude</span>
          </div>
        </footer>
      </div>
    </>
  )
}
