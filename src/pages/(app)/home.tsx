/* home pattern: product-preview-first — the ride board itself; signed-out visitors see it with sample rides */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthOverlay, useAuth, useQuery, useUserLookup } from 'deepspace'
import { Bike, CalendarClock, Lock, MapPin, Plus, Users } from 'lucide-react'
import { Badge, Button, EmptyState } from '../../components/ui'
import { NewRideModal } from '../../components/NewRideModal'
import type { Ride, Rsvp, Slot, Vote } from '../../lib/types'
import { fmtDay, fmtRelative, fmtTime, PACE_LABEL } from '../../lib/format'

interface CardModel {
  id: string
  title: string
  startArea: string
  pace?: Ride['pace']
  distanceMi?: number
  status: 'planning' | 'locked' | 'cancelled'
  when?: number
  slotCount: number
  voterCount: number
  goingCount: number
  organizer: string
  mine: boolean
}

const DAY = 24 * 3600_000

export default function HomePage() {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) return null
  return isSignedIn ? <RideBoard /> : <PreviewBoard />
}

function RideBoard() {
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const rides = useQuery<Ride>('rides', { orderBy: 'createdAt', orderDir: 'desc' })
  const slots = useQuery<Slot>('slots')
  const votes = useQuery<Vote>('votes')
  const rsvps = useQuery<Rsvp>('rsvps')
  const [creating, setCreating] = useState(false)

  const cards = useMemo<CardModel[]>(() => {
    const now = Date.now()
    return rides.records
      .filter((r) => r.data.status !== 'cancelled')
      .map((r) => {
        const rideSlots = slots.records.filter((s) => s.data.rideId === r.recordId)
        const rideVotes = votes.records.filter((v) => v.data.rideId === r.recordId)
        const upcoming = rideSlots
          .map((s) => s.data.startsAt)
          .filter((t) => t > now - 3 * 3600_000)
          .sort((a, b) => a - b)
        return {
          id: r.recordId,
          title: r.data.title,
          startArea: r.data.startArea,
          pace: r.data.pace,
          distanceMi: r.data.distanceMi,
          status: r.data.status ?? 'planning',
          when: r.data.status === 'locked' ? r.data.lockedStartsAt : upcoming[0],
          slotCount: rideSlots.length,
          voterCount: new Set(rideVotes.map((v) => v.data.userId)).size,
          goingCount: rsvps.records.filter(
            (x) => x.data.rideId === r.recordId && x.data.status === 'going',
          ).length,
          organizer: getName(r.createdBy) ?? 'Someone',
          mine: r.createdBy === userId,
        }
      })
      // Hide rides that finished more than a day ago.
      .filter((c) => !(c.status === 'locked' && c.when && c.when < now - DAY))
  }, [rides.records, slots.records, votes.records, rsvps.records, getName, userId])

  const locked = cards.filter((c) => c.status === 'locked').sort((a, b) => (a.when ?? 0) - (b.when ?? 0))
  const planning = cards.filter((c) => c.status === 'planning')

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-foreground sm:text-5xl">
            Ride board
          </h1>
          <p className="mt-1 max-w-xl text-muted-foreground">
            Propose a ride, let the group vote on times, and lock the slot with the best turnout and
            weather.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="new-ride">
          <Plus aria-hidden />
          Plan a ride
        </Button>
      </header>

      {rides.status === 'loading' ? (
        <BoardSkeleton />
      ) : cards.length === 0 ? (
        <EmptyState
          icon={<Bike />}
          title="No rides on the board"
          description="Plan the first one — pick a start area, propose a few times, and share the link with your group."
          action={{ label: 'Plan a ride', onClick: () => setCreating(true) }}
        />
      ) : (
        <div className="space-y-10">
          {locked.length > 0 && (
            <Section title="Locked in" count={locked.length}>
              {locked.map((c) => (
                <RideCard key={c.id} c={c} />
              ))}
            </Section>
          )}
          {planning.length > 0 && (
            <Section title="Picking a time" count={planning.length}>
              {planning.map((c) => (
                <RideCard key={c.id} c={c} />
              ))}
            </Section>
          )}
        </div>
      )}

      {creating && <NewRideModal open={creating} onClose={() => setCreating(false)} />}
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide text-muted-foreground">
        {title}
        <span className="text-sm tabular-nums">{count}</span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function RideCard({ c, preview }: { c: CardModel; preview?: boolean }) {
  const body = (
    <article
      data-testid="ride-card"
      className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-xl font-bold leading-tight text-foreground">
            {c.title}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin aria-hidden className="size-3 shrink-0" />
            {c.startArea}
          </p>
        </div>
        {c.status === 'locked' ? (
          <Badge variant="default" className="shrink-0 gap-1">
            <Lock aria-hidden className="size-3" /> Locked
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0">
            Voting
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <CalendarClock aria-hidden className="size-4 text-primary" />
        {c.when ? (
          <span className="text-foreground">
            {c.status === 'locked' ? '' : 'Earliest option: '}
            <strong className="font-semibold">
              {fmtDay(c.when)} · {fmtTime(c.when)}
            </strong>
            <span className="text-muted-foreground"> ({fmtRelative(c.when)})</span>
          </span>
        ) : (
          <span className="text-muted-foreground">No times proposed yet</span>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Users aria-hidden className="size-3.5" />
          {c.status === 'locked'
            ? `${c.goingCount} going`
            : `${c.voterCount} voted · ${c.slotCount} option${c.slotCount === 1 ? '' : 's'}`}
        </span>
        {c.pace && <span>{PACE_LABEL[c.pace]}</span>}
        {c.distanceMi ? <span>{c.distanceMi} mi</span> : null}
        <span className="ml-auto">{c.mine ? 'You organize' : `by ${c.organizer}`}</span>
      </div>
    </article>
  )
  if (preview) return body
  return (
    <Link to={`/rides/${c.id}`} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
      {body}
    </Link>
  )
}

function BoardSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-36 animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  )
}

/** Signed-out: the same board with sample rides, plus a sign-in CTA. */
function PreviewBoard() {
  const [signIn, setSignIn] = useState(false)
  const now = Date.now()
  const sample: CardModel[] = [
    {
      id: 'a',
      title: 'Saturday Grizzly Peak loop',
      startArea: 'Berkeley, California, US',
      pace: 'steady',
      distanceMi: 32,
      status: 'locked',
      when: now + 2 * DAY,
      slotCount: 3,
      voterCount: 7,
      goingCount: 6,
      organizer: 'Maya',
      mine: false,
    },
    {
      id: 'b',
      title: 'Sunday coffee spin',
      startArea: 'Oakland, California, US',
      pace: 'social',
      distanceMi: 18,
      status: 'planning',
      when: now + 3 * DAY,
      slotCount: 4,
      voterCount: 5,
      goingCount: 0,
      organizer: 'Jordan',
      mine: false,
    },
  ]
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Ride board</h1>
          <p className="mt-1 max-w-xl text-muted-foreground">
            Sign in to plan rides with your group. This is what the board looks like with a couple of rides on
            it.
          </p>
        </div>
        <Button onClick={() => setSignIn(true)}>Sign in to plan a ride</Button>
      </header>
      <div className="grid gap-3 opacity-90 sm:grid-cols-2" aria-label="Sample rides">
        {sample.map((c) => (
          <RideCard key={c.id} c={c} preview />
        ))}
      </div>
      {signIn && <AuthOverlay onClose={() => setSignIn(false)} />}
    </div>
  )
}
