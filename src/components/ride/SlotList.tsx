import { useState } from 'react'
import { useAuth, useMutations, useUserLookup, getUserColor } from 'deepspace'
import { Check, HelpCircle, Lock, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { Button, Input, useToast } from '../ui'
import { WeatherChip } from '../WeatherChip'
import type { Ride, Slot, Vote, VoteChoice } from '../../lib/types'
import { fmtDay, fmtTime, nextWeekdayAt, toLocalInput } from '../../lib/format'
import { cn } from '../../lib/utils'

type Rec<T> = { recordId: string; createdBy: string; data: T }

interface Props {
  rideId: string
  ride: Ride
  isOrganizer: boolean
  slots: Array<Rec<Slot>>
  votes: Array<Rec<Vote>>
  scoring: boolean
  onSlotAdded: () => void
  onLock: (slotId: string | null) => Promise<void>
  locking: string | null
}

const CHOICES: Array<{ value: VoteChoice; label: string; icon: React.ReactNode; on: string }> = [
  { value: 'yes', label: 'In', icon: <Check aria-hidden />, on: 'border-[#2e7d32] bg-[#e3f1e4] text-[#1f5f2a]' },
  {
    value: 'maybe',
    label: 'Maybe',
    icon: <HelpCircle aria-hidden />,
    on: 'border-[#b7791f] bg-[#fbefd6] text-[#7a5207]',
  },
  { value: 'no', label: 'Out', icon: <X aria-hidden />, on: 'border-[#9b2c2c] bg-[#f9e1dc] text-[#8f2414]' },
]

export function SlotList({
  rideId,
  ride,
  isOrganizer,
  slots,
  votes,
  scoring,
  onSlotAdded,
  onLock,
  locking,
}: Props) {
  const { userId } = useAuth()
  const { getUser } = useUserLookup()
  const slotMut = useMutations<Slot>('slots')
  const voteMut = useMutations<Vote>('votes')
  const { error } = useToast()

  const sorted = slots.slice().sort((a, b) => a.data.startsAt - b.data.startsAt)
  const locked = ride.status === 'locked'
  const recommended = ride.briefing?.recommendedSlotId

  async function vote(slotId: string, choice: VoteChoice) {
    const mine = votes.find((v) => v.data.slotId === slotId && v.data.userId === userId)
    try {
      if (mine && mine.data.choice === choice) await voteMut.remove(mine.recordId)
      else if (mine) await voteMut.put(mine.recordId, { choice })
      else await voteMut.create({ rideId, slotId, choice })
    } catch (e) {
      error('Vote not saved', String(e))
    }
  }

  return (
    <section aria-labelledby="when-heading">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="when-heading" className="font-display text-2xl font-bold uppercase tracking-wide">
          When
        </h2>
        <span className="text-xs text-muted-foreground">
          {scoring ? 'Updating forecast…' : 'Weather scored from a 5-day, 3-hour forecast'}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No times yet. Propose a few below — everyone can add options and vote.
        </p>
      ) : (
        <ol className="space-y-2">
          {sorted.map((s) => {
            const sv = votes.filter((v) => v.data.slotId === s.recordId)
            const mine = sv.find((v) => v.data.userId === userId)?.data.choice
            const yes = sv.filter((v) => v.data.choice === 'yes')
            const maybe = sv.filter((v) => v.data.choice === 'maybe')
            const isLocked = ride.lockedSlotId === s.recordId
            const canDelete = !locked && (s.createdBy === userId || false)
            return (
              <li
                key={s.recordId}
                data-testid="slot-row"
                className={cn(
                  'rounded-lg border bg-card p-3 sm:p-4',
                  isLocked ? 'border-primary ring-2 ring-primary/30' : 'border-border',
                  locked && !isLocked && 'opacity-60',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-xl font-bold leading-none">
                        {fmtDay(s.data.startsAt)}
                      </span>
                      <span className="font-display text-xl font-semibold leading-none text-muted-foreground">
                        {fmtTime(s.data.startsAt)}
                      </span>
                      {isLocked && (
                        <span className="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
                          <Lock aria-hidden className="size-3" /> Locked
                        </span>
                      )}
                      {!locked && recommended === s.recordId && (
                        <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-accent px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                          <Sparkles aria-hidden className="size-3" /> Brief pick
                        </span>
                      )}
                    </div>
                    <div className="mt-2">
                      <WeatherChip weather={s.data.weather} pending={scoring} />
                    </div>
                  </div>

                  <div className="flex items-center gap-1" role="group" aria-label={`Your vote for ${fmtDay(s.data.startsAt)} ${fmtTime(s.data.startsAt)}`}>
                    {CHOICES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        aria-pressed={mine === c.value}
                        disabled={!voteMut.ready || locked}
                        onClick={() => vote(s.recordId, c.value)}
                        className={cn(
                          'inline-flex h-8 items-center gap-1 rounded border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5',
                          mine === c.value
                            ? c.on
                            : 'border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                        )}
                      >
                        {c.icon}
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
                  <TallyBar yes={yes.length} maybe={maybe.length} no={sv.length - yes.length - maybe.length} />
                  <div className="flex -space-x-1.5">
                    {sv
                      .filter((v) => v.data.choice !== 'no')
                      .slice(0, 8)
                      .map((v) => {
                        const u = getUser(v.data.userId ?? '')
                        return (
                          <span
                            key={v.recordId}
                            title={`${u?.name ?? 'Rider'} — ${v.data.choice === 'yes' ? 'in' : 'maybe'}`}
                            className={cn(
                              'grid size-6 place-items-center rounded-full border-2 border-card text-[10px] font-semibold text-white',
                              v.data.choice === 'maybe' && 'opacity-60',
                            )}
                            style={{ background: getUserColor(v.data.userId ?? '') }}
                          >
                            {(u?.name?.[0] ?? '?').toUpperCase()}
                          </span>
                        )
                      })}
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Remove this time"
                        onClick={() => slotMut.remove(s.recordId)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    )}
                    {isOrganizer && !locked && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={locking === s.recordId}
                        onClick={() => onLock(s.recordId)}
                      >
                        <Lock aria-hidden />
                        Lock this time
                      </Button>
                    )}
                    {isOrganizer && isLocked && (
                      <Button size="sm" variant="ghost" loading={locking === 'unlock'} onClick={() => onLock(null)}>
                        Unlock
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {!locked && <AddSlot rideId={rideId} existing={sorted.map((s) => s.data.startsAt)} onAdded={onSlotAdded} />}
    </section>
  )
}

function TallyBar({ yes, maybe, no }: { yes: number; maybe: number; no: number }) {
  const total = yes + maybe + no
  return (
    <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
      <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-secondary" aria-hidden>
        {total > 0 && (
          <>
            <div className="bg-[#2e7d32]" style={{ width: `${(yes / total) * 100}%` }} />
            <div className="bg-[#d69e2e]" style={{ width: `${(maybe / total) * 100}%` }} />
          </>
        )}
      </div>
      <span>
        <strong className="text-foreground">{yes}</strong> in · {maybe} maybe · {no} out
      </span>
    </div>
  )
}

function AddSlot({ rideId, existing, onAdded }: { rideId: string; existing: number[]; onAdded: () => void }) {
  const { ready, createConfirmed } = useMutations<Slot>('slots')
  const { error } = useToast()
  const [custom, setCustom] = useState('')
  const [adding, setAdding] = useState(false)

  const quick = [
    { label: 'Sat 8am', at: nextWeekdayAt(6, 8) },
    { label: 'Sat 9am', at: nextWeekdayAt(6, 9) },
    { label: 'Sun 8am', at: nextWeekdayAt(0, 8) },
    { label: 'Sun 9am', at: nextWeekdayAt(0, 9) },
  ].filter((q) => !existing.includes(q.at))

  async function add(at: number) {
    if (!Number.isFinite(at) || at < Date.now()) {
      error('Pick a time in the future')
      return
    }
    if (existing.includes(at)) return
    setAdding(true)
    try {
      await createConfirmed({ rideId, startsAt: at })
      setCustom('')
      onAdded()
    } catch (e) {
      error('Could not add that time', String(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-dashed border-border p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Propose a time</p>
      <div className="flex flex-wrap items-center gap-2">
        {quick.map((q) => (
          <Button
            key={q.label}
            size="sm"
            variant="secondary"
            disabled={!ready || adding}
            onClick={() => add(q.at)}
          >
            <Plus aria-hidden />
            {q.label}
          </Button>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (custom) void add(new Date(custom).getTime())
          }}
        >
          <Input
            type="datetime-local"
            aria-label="Custom start time"
            className="h-9 w-auto"
            min={toLocalInput(Date.now())}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={!ready || !custom} loading={adding}>
            Add
          </Button>
        </form>
      </div>
    </div>
  )
}
