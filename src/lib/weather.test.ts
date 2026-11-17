import { describe, expect, it } from 'vitest'
import { scoreRideWindow, type ForecastEntry } from './weather'
import { weatherQueryFor } from './geo'

const H = 3600_000
const now = Date.UTC(2026, 10, 20, 12)

function entry(hoursFromNow: number, over: Partial<ForecastEntry> = {}): ForecastEntry {
  return {
    dt: (now + hoursFromNow * H) / 1000,
    temp: 62,
    feels_like: 62,
    humidity: 60,
    description: 'clear sky',
    icon: '01d',
    ...over,
  }
}

const forecast = [0, 3, 6, 9, 12, 15].map((h) => entry(h))

describe('scoreRideWindow', () => {
  it('scores a dry, mild window as Great', () => {
    const w = scoreRideWindow(forecast, now + 3 * H, 3, now)
    expect(w.status).toBe('ok')
    if (w.status === 'ok') {
      expect(w.score).toBe(100)
      expect(w.label).toBe('Great')
    }
  })

  it('lets a single rainy bucket inside the window dominate', () => {
    const wet = [...forecast]
    wet[3] = entry(9, { description: 'heavy intensity rain', icon: '10d' })
    const w = scoreRideWindow(wet, now + 6 * H, 4, now)
    expect(w.status).toBe('ok')
    if (w.status === 'ok') {
      expect(w.score).toBe(40)
      expect(w.reasons).toContain('heavy rain')
      expect(w.description).toBe('heavy intensity rain')
    }
  })

  it('ignores rain outside the ride window', () => {
    const wet = [...forecast]
    wet[5] = entry(15, { description: 'heavy intensity rain' })
    const w = scoreRideWindow(wet, now + 3 * H, 2, now)
    expect(w.status === 'ok' && w.score).toBe(100)
  })

  it('penalises cold feels-like temperatures', () => {
    const cold = forecast.map((e) => ({ ...e, feels_like: 40, temp: 44 }))
    const w = scoreRideWindow(cold, now + 3 * H, 2, now)
    expect(w.status === 'ok' && w.score).toBe(80)
  })

  it('reports slots beyond the 5-day forecast as out of range', () => {
    const w = scoreRideWindow(forecast, now + 6 * 24 * H, 2, now)
    expect(w.status).toBe('out_of_range')
  })

  it('reports past slots as out of range', () => {
    const w = scoreRideWindow(forecast, now - 5 * H, 2, now)
    expect(w).toMatchObject({ status: 'out_of_range', reason: 'This time has passed' })
  })
})

describe('weatherQueryFor', () => {
  it('adds a state code for US cities so OpenWeatherMap does not pick Canada', () => {
    expect(
      weatherQueryFor({ name: 'Berkeley', lat: 0, lon: 0, country: 'US', state: 'California' }),
    ).toBe('Berkeley,CA,US')
  })
  it('uses city,country elsewhere', () => {
    expect(weatherQueryFor({ name: 'Girona', lat: 0, lon: 0, country: 'ES', state: 'Catalonia' })).toBe(
      'Girona,ES',
    )
  })
})
