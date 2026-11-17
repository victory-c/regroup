/**
 * Regroup's core path, with two real signed-in riders in separate browsers:
 *
 *   A plans a ride (geocoding) → proposes a time (weather scoring) →
 *   B sees it live, B votes → A sees the vote → A locks the time →
 *   B gets the RSVP panel live and RSVPs → A sees "1 going" →
 *   A generates the AI brief → cleanup.
 *
 * Plus the server-side guards: B cannot run organizer actions, and a ride's
 * server-owned fields (AI brief, lock) reject forged client writes.
 *
 * This hits the real integrations (OpenWeatherMap geocoding + forecast, Claude
 * Haiku) once per run — a fraction of a cent — because mocking them would
 * mean mocking our own server actions, which is exactly the code under test.
 * The paid places search is not exercised here.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 usable test accounts')
test.setTimeout(150_000)

async function action(page: Page, name: string, params: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, params }) => {
      const t = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      }).then((r) => r.json() as Promise<{ token?: string }>)
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
        body: JSON.stringify(params),
      })
      return (await res.json()) as { success: boolean; error?: string; data?: unknown }
    },
    { name, params },
  )
}

test('two riders plan, vote, lock and RSVP in realtime', async ({ users }) => {
  const [a, b] = await users(2)
  let rideId = ''
  try {
    // ── A plans a ride ──────────────────────────────────────────────────
    await a.page.goto('/home')
    await a.page.getByTestId('new-ride').click()
    const title = `__test-${Date.now()}__ Grizzly loop`
    await a.page.getByLabel('Name').fill(title)
    await a.page.getByLabel('Start area').fill('Berkeley')
    await a.page.getByRole('button', { name: 'Find' }).click()
    await a.page.getByRole('radio', { name: 'Berkeley, California, US' }).click()
    await a.page.getByRole('button', { name: 'Create ride' }).click()
    await a.page.waitForURL(/\/rides\/[^/]+$/, { timeout: 20_000 })
    rideId = a.page.url().split('/rides/')[1]
    await expect(a.page.getByRole('heading', { level: 1 })).toHaveText(title)

    // ── A proposes a time; it gets scored ───────────────────────────────
    await a.page.getByRole('button', { name: 'Sat 9am' }).click()
    await expect(a.page.getByTestId('slot-row')).toHaveCount(1)
    // Either a scored chip or an honest "out of range" note — never stuck pending.
    await expect(
      a.page.getByTestId('slot-row').getByText(/^(Great|Good|Iffy|Rough)$|Forecast only covers|passed/),
    ).toBeVisible({ timeout: 30_000 })

    // ── B opens the same ride; presence shows on A's page ───────────────
    await b.page.goto(`/rides/${rideId}`)
    await expect(b.page.getByTestId('slot-row')).toHaveCount(1, { timeout: 20_000 })
    await expect(a.page.getByTestId('presence')).toBeVisible({ timeout: 20_000 })

    // B is not the organizer: no lock button.
    await expect(b.page.getByRole('button', { name: 'Lock this time' })).toHaveCount(0)

    // ── B votes; A sees it live ─────────────────────────────────────────
    await b.page.getByTestId('slot-row').getByRole('button', { name: 'In' }).click()
    await expect(a.page.getByTestId('slot-row')).toContainText('1 in', { timeout: 15_000 })

    // ── Server-side guards ──────────────────────────────────────────────
    const forged = await action(b.page, 'lockSlot', { rideId, slotId: 'whatever' })
    expect(forged).toMatchObject({ success: false, error: 'Only the ride organizer can do that' })
    const forgedBrief = await action(b.page, 'generateBrief', { rideId })
    expect(forgedBrief).toMatchObject({ success: false, error: 'Only the ride organizer can do that' })
    const unauth = await b.page.evaluate(async () =>
      (await fetch('/api/actions/scoreSlots', { method: 'POST', body: '{}' })).status,
    )
    expect(unauth).toBe(401)

    // ── A locks; B gets the RSVP panel live and RSVPs ───────────────────
    await a.page.getByRole('button', { name: 'Lock this time' }).click()
    await expect(b.page.getByTestId('rsvp-panel')).toBeVisible({ timeout: 15_000 })
    await b.page.getByRole('button', { name: 'I’m in' }).click()
    await expect(a.page.getByTestId('rsvp-panel')).toContainText('1 going', { timeout: 15_000 })

    // ── A generates the AI brief; B sees it ─────────────────────────────
    await a.page.getByTestId('brief-panel').getByRole('button', { name: 'Write brief' }).click()
    await expect(b.page.getByTestId('brief-headline')).toBeVisible({
      timeout: 60_000,
    })
  } finally {
    if (rideId) {
      const r = await action(a.page, 'deleteRide', { rideId })
      expect(r.success).toBe(true)
    }
  }
})
