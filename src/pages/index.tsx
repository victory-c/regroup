/**
 * Static landing page (no auth fetch, no WebSocket) — prerendered at build.
 * Layout: split hero — the pitch on the left, a static rendering of the real
 * slot-voting surface on the right, so the page shows the product instead of
 * describing it.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

const SAMPLE = [
  { day: 'Sat', time: '8:00 AM', label: 'Rough', detail: '51°F · heavy rain', tone: 'bg-[#f9e1dc] text-[#8f2414] border-[#efbcb2]', yes: 5, maybe: 1 },
  { day: 'Sat', time: '1:00 PM', label: 'Iffy', detail: '55°F · light rain', tone: 'bg-[#fbefd6] text-[#7a5207] border-[#efd6a0]', yes: 3, maybe: 2 },
  { day: 'Sun', time: '9:00 AM', label: 'Great', detail: '58°F · few clouds', tone: 'bg-[#e3f1e4] text-[#1f5f2a] border-[#bfdcc3]', yes: 6, maybe: 1, pick: true },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <span className="flex items-center gap-1.5 font-display text-xl font-extrabold uppercase tracking-tight">
            <span aria-hidden className="inline-block size-2.5 rotate-45 bg-primary" />
            Regroup
          </span>
          <Link to="/home" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Open the ride board →
          </Link>
        </header>

        <main className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-8 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <section>
            <p className="mb-4 font-display text-sm font-bold uppercase tracking-[0.2em] text-primary">
              Group ride planning
            </p>
            <h1 className="font-display text-5xl font-extrabold uppercase leading-[0.92] tracking-tight sm:text-7xl">
              Pick the ride time
              <br />
              everyone can make
              <br />
              <span className="text-primary">and the rain can’t.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg text-muted-foreground">
              Propose a few start times. Riders vote live, each slot is scored against the forecast, and an AI
              ride brief recommends one, checks your coffee stop is open, and tells everyone what to wear.
              Lock it, and reminders go out the day before.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                to="/home"
                className="inline-flex h-11 items-center rounded-md bg-primary px-6 font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Plan a ride
              </Link>
              <span className="text-sm text-muted-foreground">Free, sign in with Google or GitHub.</span>
            </div>
          </section>

          <section aria-label="Example: voting on ride times" className="rounded-xl border border-border bg-card p-5 shadow-[0_12px_40px_-20px_rgba(22,24,29,0.35)]">
            <p className="font-display text-2xl font-bold uppercase">Sunday hills, 35 mi</p>
            <p className="mb-4 text-xs text-muted-foreground">Berkeley, California · steady pace · 7 riders voting</p>
            <ol className="space-y-2">
              {SAMPLE.map((s) => (
                <li
                  key={s.day + s.time}
                  className={`rounded-lg border p-3 ${s.pick ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-lg font-bold">
                      {s.day} <span className="text-muted-foreground">{s.time}</span>
                    </span>
                    {s.pick && (
                      <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
                        Brief pick
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className={`rounded border px-2 py-0.5 font-medium ${s.tone}`}>
                      <strong>{s.label}</strong> · {s.detail}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      <strong className="text-foreground">{s.yes}</strong> in · {s.maybe} maybe
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 rounded-md bg-accent p-3 text-sm">
              <strong>Brief:</strong> Sunday 9am has the most riders and stays dry. The Hidden Cafe opens at 8:30, so
              the mid-ride stop works. Bring a vest for the descent.
            </p>
          </section>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-6 text-xs text-muted-foreground">
            <span>Built on DeepSpace.</span>
            <span>Weather: OpenWeatherMap · Places: Google Maps via SerpApi · Brief: Claude</span>
          </div>
        </footer>
      </div>
    </>
  )
}
