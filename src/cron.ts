/**
 * Cron tasks — run by the AppCronRoom Durable Object (worker.ts).
 *
 * `ride-reminders` emails every rider marked "going" once their locked ride
 * is within 24 hours. It's idempotent (rides record `reminderSentAt`), so a
 * 30-minute interval just bounds how late a reminder can be.
 */

import type { CronTask } from 'deepspace/worker'
import { buildCronContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { sendDueReminders } from './server/ride-ops'
import { storeFromCron } from './server/stores'

export const tasks: CronTask[] = [{ name: 'ride-reminders', intervalMinutes: 30 }]

export async function runTask(name: string, env: Env): Promise<void> {
  const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  if (name === 'ride-reminders') {
    const { sent } = await sendDueReminders(storeFromCron(ctx), `https://${env.APP_NAME}.app.space`)
    if (sent > 0) console.info(`[cron] ride-reminders emailed ${sent} rider(s)`)
  }
}
