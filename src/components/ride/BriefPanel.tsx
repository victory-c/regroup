import { AlertTriangle, Sparkles } from 'lucide-react'
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
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="brief-heading" className="flex items-center gap-1.5 font-display text-xl font-bold uppercase tracking-wide">
          <Sparkles aria-hidden className="size-4 text-primary" />
          Ride brief
        </h2>
        {isOrganizer && (
          <Button size="sm" variant={briefing ? 'outline' : 'default'} disabled={!hasSlots} loading={generating} onClick={onGenerate}>
            {briefing ? 'Regenerate' : 'Generate'}
          </Button>
        )}
      </div>

      {!briefing ? (
        <p className="text-sm text-muted-foreground">
          {isOrganizer
            ? hasSlots
              ? 'Generate a brief once a few people have voted. It weighs availability, the forecast, and your stop’s opening hours, then recommends a time.'
              : 'Add a time slot first.'
            : 'The organizer hasn’t generated a brief yet.'}
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="font-display text-lg font-semibold leading-snug">{briefing.headline}</p>
          <p className="text-muted-foreground">{briefing.summary}</p>
          {briefing.bullets.length > 0 && (
            <ul className="space-y-1.5">
              {briefing.bullets.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {briefing.warnings.length > 0 && (
            <ul className="space-y-1.5 rounded-md border border-[#efd6a0] bg-[#fdf6e7] p-2.5">
              {briefing.warnings.map((w, i) => (
                <li key={i} className="flex gap-2 text-[#7a5207]">
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Generated {fmtRelative(briefing.generatedAt)} by {briefing.model}. AI-written from the votes,
            forecast and stop hours on this page — double-check before you roll out.
          </p>
        </div>
      )}
    </section>
  )
}
