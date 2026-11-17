/**
 * Ride-weather scoring. Pure functions — no I/O — so they run identically in
 * the worker (server action) and in unit tests.
 *
 * Input is the `openweathermap/forecast` integration response: 3-hour steps
 * for the next ~5 days, each with temp / feels_like / humidity / description.
 * That endpoint does not return wind speed or precipitation probability, so
 * the score is driven by the condition text and temperature only. (Wind is
 * the biggest gap for cyclists; see README "Tradeoffs".)
 */

import type { SlotWeather, WeatherLabel } from './types'

export interface ForecastEntry {
  /** Unix seconds. */
  dt: number
  temp: number
  feels_like: number
  humidity: number
  description: string
  icon: string
}

const HOUR = 3600_000
/** Forecast entries are 3h buckets; one covers [dt - 1.5h, dt + 1.5h]. */
const HALF_STEP = 1.5 * HOUR

function conditionPenalty(description: string): { penalty: number; reason?: string } {
  const d = description.toLowerCase()
  if (d.includes('thunder')) return { penalty: 70, reason: 'thunderstorms' }
  if (d.includes('snow') || d.includes('sleet')) return { penalty: 70, reason: 'snow' }
  if (d.includes('freezing')) return { penalty: 70, reason: 'freezing rain' }
  if (d.includes('heavy') || d.includes('extreme') || d.includes('very heavy'))
    return { penalty: 60, reason: 'heavy rain' }
  if (d.includes('light rain') || d.includes('drizzle'))
    return { penalty: 25, reason: 'light rain' }
  if (d.includes('rain') || d.includes('shower')) return { penalty: 40, reason: 'rain' }
  if (d.includes('fog') || d.includes('mist') || d.includes('haze') || d.includes('smoke'))
    return { penalty: 10, reason: 'low visibility' }
  return { penalty: 0 }
}

function temperaturePenalty(feelsF: number): { penalty: number; reason?: string } {
  if (feelsF < 35) return { penalty: 35, reason: `feels like ${Math.round(feelsF)}°F` }
  if (feelsF < 45) return { penalty: 20, reason: `cold, feels like ${Math.round(feelsF)}°F` }
  if (feelsF < 52) return { penalty: 8, reason: `chilly, ${Math.round(feelsF)}°F` }
  if (feelsF > 95) return { penalty: 35, reason: `heat, ${Math.round(feelsF)}°F` }
  if (feelsF > 88) return { penalty: 15, reason: `hot, ${Math.round(feelsF)}°F` }
  return { penalty: 0 }
}

export function labelFor(score: number): WeatherLabel {
  if (score >= 80) return 'Great'
  if (score >= 60) return 'Good'
  if (score >= 40) return 'Iffy'
  return 'Rough'
}

/**
 * Score a ride window [startsAt, startsAt + durationHours] against a forecast.
 * The worst condition inside the window dominates (one rainy bucket ruins the
 * ride); temperature uses the coldest/hottest feels-like in the window.
 */
export function scoreRideWindow(
  forecast: ForecastEntry[],
  startsAt: number,
  durationHours: number,
  now: number = Date.now(),
): SlotWeather {
  const end = startsAt + Math.max(durationHours, 0.5) * HOUR

  if (startsAt < now - HOUR) {
    return { status: 'out_of_range', reason: 'This time has passed', fetchedAt: now }
  }

  const window = forecast.filter((e) => {
    const t = e.dt * 1000
    return t + HALF_STEP > startsAt && t - HALF_STEP < end
  })

  if (window.length === 0) {
    const lastT = forecast.length ? forecast[forecast.length - 1].dt * 1000 : now
    return {
      status: 'out_of_range',
      reason:
        startsAt > lastT
          ? 'Forecast only covers the next 5 days'
          : 'No forecast available for this window',
      fetchedAt: now,
    }
  }

  let worstCondition: { penalty: number; reason?: string; entry: ForecastEntry } = { penalty: 0, entry: window[0] }
  for (const e of window) {
    const c = conditionPenalty(e.description)
    if (c.penalty > worstCondition.penalty) worstCondition = { ...c, entry: e }
  }

  const feels = window.map((e) => e.feels_like)
  const coldest = Math.min(...feels)
  const hottest = Math.max(...feels)
  const coldPenalty = temperaturePenalty(coldest)
  const hotPenalty = temperaturePenalty(hottest)
  const tempPenalty = coldPenalty.penalty >= hotPenalty.penalty ? coldPenalty : hotPenalty

  const reasons = [worstCondition.reason, tempPenalty.reason].filter(Boolean) as string[]
  const score = Math.max(0, Math.min(100, 100 - worstCondition.penalty - tempPenalty.penalty))

  // Representative entry: the worst-condition bucket if there is one, else the
  // bucket nearest the start.
  const rep =
    worstCondition.penalty > 0
      ? worstCondition.entry
      : window.reduce((a, b) =>
          Math.abs(a.dt * 1000 - startsAt) <= Math.abs(b.dt * 1000 - startsAt) ? a : b,
        )

  return {
    status: 'ok',
    score,
    label: labelFor(score),
    tempF: Math.round(rep.temp),
    feelsF: Math.round(rep.feels_like),
    description: rep.description,
    icon: rep.icon,
    reasons: reasons.length ? reasons : ['dry, comfortable temps'],
    fetchedAt: now,
  }
}
