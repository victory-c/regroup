import { AlertTriangle } from 'lucide-react'
import { Button } from '../ui'
import type { Briefing } from '../../lib/types'
import { fmtRelative } from '../../lib/format'

interface Props {
  briefing?: Briefing
  isOrganizer: boolean
  hasSlots: boolean
  generating: boolean
  onGenerate: () => void
}

export function BriefPanel({ briefing, isOrganizer, hasSlots, generating, onGenerate }: Props) {
  return (
    <section
      aria-labelledby="brief-heading"
      data-testid="brief-panel"
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="brief-heading" className="text-lg font-semibold">
          Ride brief
        </h2>
        {isOrganizer && (
          <Button
            size="sm"
            variant={briefing ? 'outline' : 'default'}
            disabled={!hasSlots}
            loading={generating}
            onClick={onGenerate}
          >
            {briefing ? 'Rewrite brief' : 'Write brief'}
          </Button>
        )}
      </div>

      {!briefing ? (
        <p className="text-sm text-muted-foreground">
          {isOrganizer
            ? hasSlots
              ? 'Once a few riders have voted, the brief picks a time from the votes, the forecast and your stop’s hours, and tells everyone what to bring.'
              : 'Add a time first.'
            : 'The organizer hasn’t written a brief yet.'}
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <p data-testid="brief-headline" className="text-base font-semibold leading-snug">
            {briefing.headline}
          </p>
          <p className="text-muted-foreground">{briefing.summary}</p>
          {briefing.bullets.length > 0 && (
            <ul className="space-y-2">
              {briefing.bullets.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {briefing.warnings.length > 0 && (
            <ul className="space-y-2 rounded-lg border border-warning-line bg-warning-soft p-3">
              {briefing.warnings.map((w, i) => (
                <li key={i} className="flex gap-2 text-warning-ink">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Written {fmtRelative(briefing.generatedAt)} by {briefing.model} from the votes, forecast and stop
            hours on this page. Check it before you roll out.
          </p>
        </div>
      )}
    </section>
  )
}
