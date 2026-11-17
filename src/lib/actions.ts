import { getAuthToken } from 'deepspace'

export type ActionResponse<T> = { success: true; data: T } | { success: false; error: string }

/** POST /api/actions/<name> with the caller's JWT. Never throws. */
export async function callAction<T = unknown>(
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResponse<T>> {
  try {
    const token = await getAuthToken()
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    })
    if (res.status === 401) return { success: false, error: 'Sign in to do that' }
    const body = (await res.json()) as ActionResponse<T>
    if (!body.success) return { success: false, error: body.error || 'Request failed' }
    return body
  } catch {
    return { success: false, error: 'Network error — check your connection' }
  }
}
