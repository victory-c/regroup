/**
 * Adapters from the two RBAC-bypassing worker APIs (server-action `tools` and
 * the cron context) onto the small `Store` interface ride-ops.ts is written
 * against, so the same logic runs from a button click or a schedule.
 */

import type { ActionTools, CronContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { unwrapIntegration, UserFacingError, writeError, type Envelope, type Store } from './ride-ops'

export const QUERY_PAGE = 500
/** 100 pages × 500 = 50k rows: far past anything Regroup holds; a runaway guard, not a cap. */
const MAX_PAGES = 100

interface Page<T> {
  records: Array<Envelope<T>>
  nextOffset?: number
}

/**
 * Read every page of a query. The RecordRoom answers `nextOffset` while more
 * rows match; ordering oldest-first keeps offsets stable as new rows arrive.
 * Exported for unit tests.
 */
export async function collectPages<T>(fetchPage: (offset: number) => Promise<Page<T>>) {
  const all: Array<Envelope<T>> = []
  let offset = 0
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await fetchPage(offset)
    all.push(...page.records)
    if (page.nextOffset === undefined || page.nextOffset <= offset) return all
    offset = page.nextOffset
  }
  throw new Error(`query exceeded ${MAX_PAGES * QUERY_PAGE} rows`)
}

function pageParams(where: Record<string, unknown> | undefined, offset: number) {
  return { where, orderBy: 'createdAt', orderDir: 'asc' as const, limit: QUERY_PAGE, offset }
}

export function storeFromActionTools(tools: ActionTools): Store {
  return {
    async query<T>(collection: string, where?: Record<string, unknown>) {
      return collectPages<T>(async (offset) => {
        // `offset` is forwarded to the RecordRoom; the SDK type just omits it.
        const r = await tools.query(collection, pageParams(where, offset) as Parameters<ActionTools['query']>[1])
        if (!r.success) throw new Error(r.error)
        return r.data as unknown as Page<T>
      })
    },
    async get<T>(collection: string, id: string) {
      const r = await tools.get(collection, id)
      if (!r.success) return null
      return (r.data as { record: Envelope<T> }).record
    },
    async create(collection, data) {
      const r = await tools.create(collection, data)
      if (!r.success) throw writeError(r.error)
      return r.data.recordId
    },
    async update(collection, id, patch) {
      const r = await tools.update(collection, id, patch)
      if (!r.success) throw new Error(r.error)
    },
    async remove(collection, id) {
      const r = await tools.remove(collection, id)
      if (!r.success) throw new Error(r.error)
    },
    async integration(endpoint, body) {
      const r = await tools.integration(endpoint, body)
      if (!r.success) throw new UserFacingError(r.error || `${endpoint} failed`)
      return r.data
    },
  }
}

type ToolResult = { success: boolean; data?: unknown; error?: string }

/**
 * The cron context's `records.query` drops `offset`, so cron record access
 * talks to the RecordRoom directly, the same way `buildCronContext` does
 * (as the app owner, with per-record RBAC off).
 */
function recordRoomTool(env: Env) {
  const room = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  return async (tool: string, params: Record<string, unknown>): Promise<ToolResult> => {
    const res = await room.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': env.OWNER_USER_ID,
          'X-App-Action': 'true',
        },
        body: JSON.stringify({ tool, params }),
      }),
    )
    return (await res.json()) as ToolResult
  }
}

export function storeFromCron(ctx: CronContext, env: Env): Store {
  const exec = recordRoomTool(env)
  return {
    async query<T>(collection: string, where?: Record<string, unknown>) {
      return collectPages<T>(async (offset) => {
        const r = await exec('records.query', { collection, ...pageParams(where, offset) })
        if (!r.success) throw new Error(r.error)
        return r.data as Page<T>
      })
    },
    async get<T>(collection: string, id: string) {
      const r = await exec('records.get', { collection, recordId: id })
      if (!r.success) return null
      return (r.data as { record: Envelope<T> }).record
    },
    async create(collection, data) {
      const r = await exec('records.create', { collection, data })
      if (!r.success) throw writeError(r.error)
      return (r.data as { recordId: string }).recordId
    },
    async update(collection, id, patch) {
      const r = await exec('records.update', { collection, recordId: id, data: patch })
      if (!r.success) throw new Error(r.error)
    },
    async remove(collection, id) {
      const r = await exec('records.delete', { collection, recordId: id })
      if (!r.success) throw new Error(r.error)
    },
    async integration(endpoint, body) {
      return unwrapIntegration(await ctx.integrations.call(endpoint, body))
    },
  }
}
