import { useState } from 'react'
import { useAuth, useMutations, useUserLookup, getUserColor } from 'deepspace'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { Button, Input, useToast } from '../ui'
import { WeatherChip } from '../WeatherChip'
import { ForecastStrip } from '../ForecastStrip'
import type { Ride, Slot, Vote, VoteChoice } from '../../lib/types'
import { fmtDay, fmtTime, nextWeekdayAt, toLocalInput } from '../../lib/format'
import { cn } from '../../lib/utils'
import { callAction } from '../../lib/actions'

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

const CHOICES: Array<{ value: VoteChoice; label: string }> = [
  { value: 'yes', label: 'In' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'Out' },
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
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="when-heading" className="text-xl font-semibold">
          When
        </h2>
        <span className="text-sm text-muted-foreground">
          {scoring ? 'Updating the forecast' : 'Scored on the forecast for the whole ride'}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input bg-card p-6 text-center text-sm text-muted-foreground">
          No times yet. Propose a few below, and anyone in the group can add more.
        </p>
      ) : (
        <ol className="space-y-3">
          {sorted.map((s) => {
            const sv = votes.filter((v) => v.data.slotId === s.recordId)
            const mine = sv.find((v) => v.data.userId === userId)?.data.choice
            const yes = sv.filter((v) => v.data.choice === 'yes')
            const maybe = sv.filter((v) => v.data.choice === 'maybe')
            const isLocked = ride.lockedSlotId === s.recordId
            const isRecommended = !locked && recommended === s.recordId
            const canDelete = !locked && (s.createdBy === userId || isOrganizer)
            const showStrip = s.data.weather?.status === 'ok'
            return (
              <li
                key={s.recordId}
                data-testid="slot-row"
                className={cn(
                  'rounded-xl border bg-card p-4 sm:p-5',
                  isLocked || isRecommended ? 'border-primary' : 'border-border',
                  locked && !isLocked && 'opacity-60',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="text-lg font-semibold tabular-nums">
                        {fmtDay(s.data.startsAt)}, {fmtTime(s.data.startsAt)}
                      </p>
                      {isLocked && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                          <Lock aria-hidden className="size-3" /> Locked
                        </span>
                      )}
                      {isRecommended && (
                        <span className="text-sm font-medium text-primary-ink">Recommended by the brief</span>
                      )}
                    </div>
                    <WeatherChip weather={s.data.weather} pending={scoring} />
                  </div>

                  <div
                    role="group"
                    aria-label={`Your vote for ${fmtDay(s.data.startsAt)} ${fmtTime(s.data.startsAt)}`}
                    className="inline-flex rounded-lg border border-input bg-background p-0.5"
                  >
                    {CHOICES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        aria-pressed={mine === c.value}
                        disabled={!voteMut.ready || locked}
                        onClick={() => vote(s.recordId, c.value)}
                        className={cn(
                          'h-8 min-w-14 rounded-md px-3 text-sm font-medium transition-colors duration-150 ease-(--ease-out-soft) disabled:cursor-not-allowed disabled:opacity-50',
                          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                          mine === c.value
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {showStrip && (
                  <ForecastStrip
                    className="mt-5 max-w-md"
                    entries={ride.forecastCache?.entries}
                    startsAt={s.data.startsAt}
                    durationHours={ride.durationHours ?? 2}
                  />
                )}

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
                  <TallyBar yes={yes.length} maybe={maybe.length} no={sv.length - yes.length - maybe.length} />
                  <Paceline
                    riders={sv
                      .filter((v) => v.data.choice !== 'no')
                      .sort((a) => (a.data.choice === 'yes' ? -1 : 1))
                      .map((v) => ({
                        id: v.data.userId ?? v.recordId,
                        name: getUser(v.data.userId ?? '')?.name ?? 'Rider',
                        maybe: v.data.choice === 'maybe',
                      }))}
                  />
                  <div className="ml-auto flex items-center gap-1">
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Remove this time"
                        onClick={async () => {
                          const r = await callAction('removeSlot', { slotId: s.recordId })
                          if (!r.success) error('Could not remove that time', r.error)
                        }}
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
    <div className="flex items-center gap-3 text-sm tabular-nums text-muted-foreground">
      <div className="flex h-1.5 w-20 overflow-hidden rounded-full bg-secondary" aria-hidden>
        {total > 0 && (
          <>
            <div className="bg-foreground" style={{ width: `${(yes / total) * 100}%` }} />
            <div className="bg-muted-foreground" style={{ width: `${(maybe / total) * 100}%` }} />
          </>
        )}
      </div>
      <span>
        <span className="font-semibold text-foreground">{yes}</span> in, {maybe} maybe, {no} out
      </span>
    </div>
  )
}

/** Signature detail: riders who are in, single file like a paceline. */
function Paceline({ riders }: { riders: Array<{ id: string; name: string; maybe: boolean }> }) {
  if (riders.length === 0) return null
  const shown = riders.slice(0, 8)
  return (
    <ol className="flex items-center gap-1" aria-label={riders.map((r) => `${r.name}${r.maybe ? ' (maybe)' : ''}`).join(', ')}>
      {shown.map((r) => (
        <li
          key={r.id}
          title={`${r.name}${r.maybe ? ', maybe' : ''}`}
          className={cn(
            'grid size-6 place-items-center rounded-full text-[11px] font-semibold text-white',
            r.maybe && 'opacity-50',
          )}
          style={{ background: getUserColor(r.id) }}
        >
          {(r.name[0] ?? '?').toUpperCase()}
        </li>
      ))}
      {riders.length > shown.length && (
        <li className="text-xs text-muted-foreground">+{riders.length - shown.length}</li>
      )}
    </ol>
  )
}

function AddSlot({ rideId, existing, onAdded }: { rideId: string; existing: number[]; onAdded: () => void }) {
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
    const r = await callAction('addSlot', { rideId, startsAt: at })
    setAdding(false)
    if (!r.success) {
      error('Could not add that time', r.error)
      return
    }
    setCustom('')
    onAdded()
  }

  return (
    <div className="mt-4 rounded-xl border border-dashed border-input p-4">
      <p className="mb-3 text-sm font-medium">Propose a time</p>
      <div className="flex flex-wrap items-center gap-2">
        {quick.map((q) => (
          <Button
            key={q.label}
            size="sm"
            variant="secondary"
            disabled={adding}
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
          <Button size="sm" type="submit" disabled={!custom} loading={adding}>
            Add
          </Button>
        </form>
      </div>
    </div>
  )
}
