import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getUserColor, useAuth, usePresenceRoom, useQuery, useUserLookup } from 'deepspace'
import { ArrowLeft, Clock, Gauge, MapPin, Route, Share2, Trash2 } from 'lucide-react'
import { Button, ConfirmModal, EmptyState, useToast } from '../../../../components/ui'
import { SlotList } from '../../../../components/ride/SlotList'
import { BriefPanel } from '../../../../components/ride/BriefPanel'
import { StopPanel } from '../../../../components/ride/StopPanel'
import { RsvpPanel } from '../../../../components/ride/RsvpPanel'
import { callAction } from '../../../../lib/actions'
import { PACE_LABEL } from '../../../../lib/format'
import { briefBasis, isBriefStale } from '../../../../lib/brief-basis'
import type { Ride, Rsvp, Slot, Vote } from '../../../../lib/types'

const FORECAST_STALE_MS = 3 * 3600_000

export default function RidePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const { success, error } = useToast()

  const rides = useQuery<Ride>('rides')
  const slots = useQuery<Slot>('slots', { where: { rideId: id } })
  const votes = useQuery<Vote>('votes', { where: { rideId: id } })
  const rsvps = useQuery<Rsvp>('rsvps', { where: { rideId: id } })
  const rideRec = rides.records.find((r) => r.recordId === id)
  const ride = rideRec?.data
  const isOrganizer = !!rideRec && rideRec.createdBy === userId

  const [busy, setBusy] = useState<string | null>(null)
  const [scoring, setScoring] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // ── weather: score on open when anything is unscored or stale ─────────
  const scoreRequested = useRef(false)
  const runScore = useCallback(async () => {
    setScoring(true)
    const r = await callAction('scoreSlots', { rideId: id })
    setScoring(false)
    if (!r.success) error('Forecast update failed', r.error)
  }, [id, error])

  useEffect(() => {
    if (scoreRequested.current || slots.status !== 'ready' || !ride) return
    const now = Date.now()
    const needs = slots.records.some(
      (s) => !s.data.weather || now - s.data.weather.fetchedAt > FORECAST_STALE_MS,
    )
    if (needs) {
      scoreRequested.current = true
      void runScore()
    }
  }, [slots.status, slots.records, ride, runScore])

  // ── action wrappers ───────────────────────────────────────────────────
  async function act(key: string, name: string, params: Record<string, unknown>, ok?: string) {
    setBusy(key)
    const r = await callAction(name, { rideId: id, ...params })
    setBusy(null)
    if (!r.success) error(r.error)
    else if (ok) success(ok)
    return r.success
  }

  // ── presence: who's looking at this ride right now ────────────────────
  const { peers } = usePresenceRoom(`ride:${id}`)
  const here = useMemo(() => {
    const seen = new Set<string>()
    return peers.filter((p) => (seen.has(p.userId) ? false : (seen.add(p.userId), true)))
  }, [peers])

  const briefStale = useMemo(
    () =>
      !!ride?.briefing &&
      // Empty-while-loading lists would look like "everything changed".
      [slots.status, votes.status, rsvps.status].every((st) => st === 'ready') &&
      isBriefStale(ride.briefing, briefBasis(ride, slots.records, votes.records, rsvps.records)),
    [ride, slots.status, votes.status, rsvps.status, slots.records, votes.records, rsvps.records],
  )

  const focusSlot = ride?.lockedSlotId ?? ride?.briefing?.recommendedSlotId ?? undefined
  const focusStart = slots.records.find((s) => s.recordId === focusSlot)?.data.startsAt
  const dayKey = focusStart
    ? new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(focusStart)).toLowerCase()
    : undefined

  if (rides.status === 'loading') {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-muted-foreground">Loading ride…</div>
  }
  if (!ride || !rideRec) {
    return (
      <EmptyState
        className="mx-auto max-w-5xl"
        title="Ride not found"
        description="It may have been deleted by its organizer."
        action={{ label: 'Back to the board', onClick: () => navigate('/home') }}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link to="/home" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Ride board
      </Link>

      <header className="mb-8 border-b border-border pb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-tight tracking-[-0.01em] sm:text-4xl">
              {ride.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Organized by {isOrganizer ? 'you' : (getName(rideRec.createdBy) ?? 'a rider')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PresenceStack here={here} />
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href)
                  success('Link copied — share it with your group')
                } catch {
                  error('Copy failed', window.location.href)
                }
              }}
            >
              <Share2 aria-hidden /> Share
            </Button>
            {isOrganizer && (
              <Button variant="ghost" size="sm" aria-label="Delete ride" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
        </div>

        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Meta icon={<MapPin aria-hidden />} label="Start" value={ride.startArea} />
          <Meta icon={<Clock aria-hidden />} label="Duration" value={`${ride.durationHours ?? 2} h`} />
          {ride.distanceMi ? <Meta icon={<Route aria-hidden />} label="Distance" value={`${ride.distanceMi} mi`} /> : null}
          {ride.pace && <Meta icon={<Gauge aria-hidden />} label="Pace" value={PACE_LABEL[ride.pace]} />}
        </dl>
        {ride.notes && <p className="mt-3 max-w-2xl whitespace-pre-line text-sm">{ride.notes}</p>}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <SlotList
            rideId={id}
            ride={ride}
            isOrganizer={isOrganizer}
            slots={slots.records}
            votes={votes.records}
            scoring={scoring}
            onSlotAdded={() => void runScore()}
            locking={busy?.startsWith('lock') ? (busy.slice(5) || 'unlock') : null}
            onLock={async (slotId) => {
              await act(
                slotId ? `lock:${slotId}` : 'lock:',
                'lockSlot',
                { slotId },
                slotId ? 'Time locked — riders can RSVP now' : 'Unlocked',
              )
            }}
          />
        </div>

        <aside className="space-y-4">
          {ride.status === 'locked' && (
            <RsvpPanel
              rideId={id}
              ride={ride}
              rsvps={rsvps.records}
              isOrganizer={isOrganizer}
              sending={busy === 'remind'}
              onSendReminder={() => void act('remind', 'sendReminderNow', {}, 'Reminder sent')}
            />
          )}
          <BriefPanel
            briefing={ride.briefing}
            stale={briefStale}
            isOrganizer={isOrganizer}
            hasSlots={slots.records.length > 0}
            generating={busy === 'brief'}
            onGenerate={() => void act('brief', 'generateBrief', {})}
          />
          <StopPanel
            rideId={id}
            ride={ride}
            isOrganizer={isOrganizer}
            dayKey={dayKey}
            searching={busy === 'stops'}
            onSearch={(q) => void act('stops', 'findStops', { query: q })}
          />
        </aside>
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this ride?"
        description="Removes the ride, its proposed times, votes and RSVPs for everyone."
        confirmText="Delete ride"
        loading={busy === 'delete'}
        onConfirm={async () => {
          if (await act('delete', 'deleteRide', {})) navigate('/home')
        }}
      />
    </div>
  )
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      <dt className="sr-only">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function PresenceStack({ here }: { here: Array<{ userId: string; userName: string }> }) {
  if (here.length === 0) return null
  return (
    <div className="flex items-center gap-2" data-testid="presence" aria-label={`${here.length} other rider(s) viewing`}>
      <div className="flex items-center gap-1">
        {here.slice(0, 5).map((p) => (
          <span
            key={p.userId}
            title={`${p.userName} is here`}
            className="grid size-7 place-items-center rounded-full text-[11px] font-semibold text-white"
            style={{ background: getUserColor(p.userId) }}
          >
            {(p.userName?.[0] ?? '?').toUpperCase()}
          </span>
        ))}
      </div>
      <span className="hidden text-sm text-muted-foreground sm:inline">{here.length} here now</span>
    </div>
  )
}
