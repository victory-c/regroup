/**
 * Adapters from the two RBAC-bypassing worker APIs (server-action `tools` and
 * the cron context) onto the small `Store` interface ride-ops.ts is written
 * against, so the same logic runs from a button click or a schedule.
 */

import type { ActionTools, CronContext } from 'deepspace/worker'
import { unwrapIntegration, UserFacingError, type Envelope, type Store } from './ride-ops'

export function storeFromActionTools(tools: ActionTools): Store {
  return {
    async query<T>(collection: string, where?: Record<string, unknown>) {
      const r = await tools.query(collection, { where, limit: 500 })
      if (!r.success) throw new Error(r.error)
      return r.data.records as unknown as Array<Envelope<T>>
    },
    async get<T>(collection: string, id: string) {
      const r = await tools.get(collection, id)
      if (!r.success) return null
      return (r.data as { record: Envelope<T> }).record
    },
    async update(collection, id, patch) {
      const r = await tools.update(collection, id, patch)
      if (!r.success) throw new Error(r.error)
    },
    async integration(endpoint, body) {
      const r = await tools.integration(endpoint, body)
      if (!r.success) throw new UserFacingError(r.error || `${endpoint} failed`)
      return r.data
    },
  }
}

export function storeFromCron(ctx: CronContext): Store {
  return {
    async query<T>(collection: string, where?: Record<string, unknown>) {
      return (await ctx.records.query(collection, { where, limit: 500 })) as unknown as Array<
        Envelope<T>
      >
    },
    async get<T>(collection: string, id: string) {
      const rows = (await ctx.records.query(collection, {
        where: { recordId: id },
        limit: 1,
      })) as unknown as Array<Envelope<T>>
      return rows[0] ?? null
    },
    async update(collection, id, patch) {
      await ctx.records.update(collection, id, patch)
    },
    async integration(endpoint, body) {
      return unwrapIntegration(await ctx.integrations.call(endpoint, body))
    },
  }
}
