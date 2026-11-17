import type { Pace } from './types'

export function fmtDay(ms: number) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(ms),
  )
}

export function fmtTime(ms: number) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
}

export function fmtRelative(ms: number, now = Date.now()) {
  const diff = ms - now
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < 48 * 3600_000) return rtf.format(Math.round(diff / 3600_000), 'hour')
  return rtf.format(Math.round(diff / (24 * 3600_000)), 'day')
}

export const PACE_LABEL: Record<Pace, string> = {
  social: 'Social, no-drop',
  steady: 'Steady, conversational',
  spirited: 'Spirited, some surges',
  race: 'Race pace',
}

/** Next occurrence of weekday (0=Sun) at hour:00 local, at least ~12h away. */
export function nextWeekdayAt(weekday: number, hour: number, now = new Date()) {
  const d = new Date(now)
  d.setHours(hour, 0, 0, 0)
  let add = (weekday - d.getDay() + 7) % 7
  if (add === 0 && d.getTime() - now.getTime() < 12 * 3600_000) add = 7
  d.setDate(d.getDate() + add)
  return d.getTime()
}

/** Value for <input type="datetime-local"> from epoch ms (local time). */
export function toLocalInput(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
