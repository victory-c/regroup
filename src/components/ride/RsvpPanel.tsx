import { useAuth, useMutations, useUserLookup } from 'deepspace'
import { Mail, UserCheck } from 'lucide-react'
import { Button, useToast } from '../ui'
import type { Ride, Rsvp } from '../../lib/types'
import { fmtDay, fmtRelative, fmtTime } from '../../lib/format'
import { cn } from '../../lib/utils'

type Rec<T> = { recordId: string; createdBy: string; data: T }

interface Props {
  rideId: string
  ride: Ride
  rsvps: Array<Rec<Rsvp>>
  isOrganizer: boolean
  sending: boolean
  onSendReminder: () => void
}

export function RsvpPanel({ rideId, ride, rsvps, isOrganizer, sending, onSendReminder }: Props) {
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const { ready, create, put } = useMutations<Rsvp>('rsvps')
  const { error } = useToast()
  const mine = rsvps.find((r) => r.data.userId === userId)
  const going = rsvps.filter((r) => r.data.status === 'going')

  async function set(status: Rsvp['status']) {
    try {
      if (mine) await put(mine.recordId, { status })
      else await create({ rideId, status })
    } catch (e) {
      error('RSVP not saved', String(e))
    }
  }

  return (
    <section
      aria-labelledby="rsvp-heading"
      className="rounded-xl border border-primary bg-card p-5"
      data-testid="rsvp-panel"
    >
      <h2 id="rsvp-heading" className="text-lg font-semibold tabular-nums">
        Rolling out {ride.lockedStartsAt ? `${fmtDay(ride.lockedStartsAt)}, ${fmtTime(ride.lockedStartsAt)}` : ''}
      </h2>
      {ride.lockedStartsAt && (
        <p className="text-sm text-muted-foreground">
          {fmtRelative(ride.lockedStartsAt)}, meeting in {ride.startArea.split(',')[0]}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button
          className="flex-1"
          variant={mine?.data.status === 'going' ? 'default' : 'secondary'}
          aria-pressed={mine?.data.status === 'going'}
          disabled={!ready}
          onClick={() => set('going')}
        >
          <UserCheck aria-hidden />
          I’m in
        </Button>
        <Button
          className="flex-1"
          variant={mine?.data.status === 'out' ? 'secondary' : 'ghost'}
          aria-pressed={mine?.data.status === 'out'}
          disabled={!ready}
          onClick={() => set('out')}
        >
          Can’t make it
        </Button>
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium tabular-nums">{going.length} going</p>
        <p className={cn('mt-1 text-sm', going.length === 0 && 'text-muted-foreground')}>
          {going.length === 0
            ? 'Nobody yet.'
            : going.map((r) => (r.data.userId === userId ? 'You' : (getName(r.data.userId ?? '') ?? 'Rider'))).join(', ')}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        {ride.reminderSentAt
          ? `Reminder emailed ${fmtRelative(ride.reminderSentAt)}.`
          : 'Riders who are in get a reminder email within 24 hours of the start.'}
        {isOrganizer && (
          <Button size="sm" variant="ghost" className="h-8 px-2" loading={sending} onClick={onSendReminder}>
            <Mail aria-hidden />
            Send now
          </Button>
        )}
      </div>
    </section>
  )
}
