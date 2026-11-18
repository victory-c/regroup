/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays (default).
 * - 'user': The calling user pays.
 *
 * Every integration requires a signed-in caller. Set `anonymous: true` on a
 * 'developer' integration to let signed-out visitors call it too — the owner
 * then pays for anyone who can reach the app.
 *
 * Integrations not listed here default to 'developer' with sign-in required.
 *
 * IMPORTANT: any integration backed by per-user connected accounts (Google,
 * Composio) must be 'user' — the api-worker resolves the account from the
 * JWT subject. With 'developer' the app owner's JWT is forwarded, so every
 * signed-in user connects and acts on the app owner's account. Server code
 * that acts for a user in the background (e.g. a cron job) uses
 * `callComposio(env, ..., { asUser })` from 'deepspace/worker' instead.
 */

export const integrations: Record<
  string,
  { billing: 'developer' | 'user'; anonymous?: boolean }
> = {
  google: { billing: 'user' },
  composio: { billing: 'user' },
  // Regroup's integrations are owner-billed. Forecast, places search, the AI
  // brief and email are only ever called from server actions / cron, behind a
  // signed-in caller plus organizer checks and cooldowns. The one browser
  // call is `openweathermap/geocoding` in NewRideModal (the start-area lookup
  // when planning a ride): it goes through the platform proxy, still needs a
  // signed-in user, and its result is only a suggestion the user picks from.
  openweathermap: { billing: 'developer' },
  serpapi: { billing: 'developer' },
  anthropic: { billing: 'developer' },
  email: { billing: 'developer' },
}
