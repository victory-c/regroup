# Regroup

**Group ride planning without the group-chat chaos.** Propose a few start times, riders vote live, every slot is scored against the forecast, the organizer picks a coffee stop, and an AI ride brief recommends a time, checks the stop is open, and tells everyone what to wear. Lock it, riders RSVP, and a reminder email goes out the day before.

Live: https://regroup.app.space · Built on [DeepSpace](https://docs.deep.space).

## The core flow

1. **Plan a ride**: name, start area (geocoded, so "Berkeley" means California, not Ontario), duration, distance, pace.
2. **Propose times**: one-tap "Sat 8am / Sun 9am" chips or any custom time. Anyone in the group can add options.
3. **Vote live**: In / Maybe / Out per slot. Tallies, voter avatars and "who's here now" update in realtime for everyone on the page.
4. **Weather per slot**: each slot is scored 0–100 (Great / Good / Iffy / Rough) from the forecast across the *whole ride window*, not just the start hour, with the reason shown inline ("light rain, cold, feels like 41°F").
5. **Regroup stop**: the organizer searches ("coffee", "bakery") near the start and picks one. The opening hours are shown for the ride's day.
6. **AI ride brief**: Claude weighs availability, weather and the stop's hours, recommends a slot, and writes what to bring plus warnings. The recommended slot is highlighted.
7. **Lock and RSVP**: the organizer locks a slot, riders RSVP, and a cron job emails "going" riders within 24h of the start (or the organizer hits "Send now").

## DeepSpace pieces used, and why

| Piece | Used for | Why it earns its place |
| --- | --- | --- |
| **RecordRoom collections** (`rides`, `slots`, `votes`, `rsvps`) | All app data, live-synced over WebSocket | Voting is only useful if everyone sees the same tally at the same time. |
| **RBAC in the schema** | `update/delete: 'own'`, `writableFields`, `uniqueOn` + `userBound` | One vote per rider per slot and one RSVP per ride are enforced in the Durable Object, so a forged client write can't stuff the ballot or vote as someone else. Server-computed fields (weather, AI brief, stop results, lock state) are outside `writableFields`, so clients can't forge them. |
| **Server actions** | `scoreSlots`, `findStops`, `generateBrief`, `lockSlot`, `sendReminderNow`, `deleteRide` | Organizer checks, cooldowns and owner-billed integration calls run server-side, with the caller from the verified JWT. Results are written once and broadcast to everyone. |
| **Presence room** (`usePresenceRoom`) | "2 here now" avatars on a ride | Shows the group is deciding together. |
| **Cron** (`CronRoom`) | `ride-reminders` every 30 min | Idempotent via `reminderSentAt`, so the interval only bounds lateness. |
| **Auth** | Google/GitHub sign-in, user directory for names/avatars | Uses the built-in `useUsers` public-identity projection, so emails never reach other members. |

### Integrations (all through the DeepSpace proxy, no API keys in the repo)

| Integration | Used for |
| --- | --- |
| `openweathermap/geocoding` | Resolving the start area to a precise city. |
| `openweathermap/forecast` | Slot weather scoring. Cached on the ride for 30 min, so a busy page costs at most one call per ride per half hour. |
| `serpapi/places-search` | Regroup-stop suggestions with ratings and weekly hours. |
| `anthropic/chat-completion` (Claude Haiku 5.5) | The ride brief. |
| `email/send` | Ride reminders. |

### Deliberately left out

- **Maps / route drawing.** There's no maps integration, and plotting routes is a different product (DeepSpace's own RunningMap example covers it). Riders paste a route link in the notes.
- **AI chat (`add ai-chat`).** A chat box would be a worse UI for one well-defined job ("pick a time and tell us what to bring"). A single structured brief is easier to trust and verify.
- **Messaging / comments.** Every group already has a chat. Regroup replaces the *scheduling* thread, not the banter.
- **Payments, file uploads.** No real need in a free ride planner.
- **Private groups / teams.** Every signed-in user can see every ride (link-sharing model). See "Next steps".

## Main tradeoff

**Server-computed, shared results vs. calling integrations from the browser.** Weather, stop search and the AI brief all run in server actions and write into fields clients can't touch, instead of each browser calling `integration.post` and rendering its own copy. That costs a round-trip and a bit more code (a small `Store` interface so actions and cron share logic). In return, every rider sees *the same* score and brief, the owner-billed calls are rate-limited and organizer-gated in one place, and nobody can forge an "AI says Saturday" brief.

**A smaller one: wind.** The platform's forecast endpoint returns temperature, humidity and conditions but **no wind speed or rain probability**. Wind matters a lot on a bike. I chose to stay on the platform integration (consistent billing, no extra keys) and say so plainly in the UI tooltip and the AI prompt ("do not invent wind"), rather than bolt on a second weather provider for one field.

## Design

The direction lives at the top of `src/pages/index.tsx`, following DeepSpace's own [design workflow](https://docs.deep.space/design/overview).

- **Look:** cool asphalt-grey neutrals with one ember-orange accent (hi-vis kit, 4.6:1 with white text). One family throughout: Barlow, which has road-signage letterforms. Sentence case.
- **Where orange appears:** only the primary action, the locked or recommended slot, and the ride window.
- **The one rich element:** the forecast strip on each slot. It shows the 3-hour buckets around the slot with the ride window bracketed, built from the forecast already cached on the ride. It shows *why* a slot is "Iffy".
- **Signature detail:** riders who are in appear single file, like a paceline.
- **Checked against DeepSpace's [anti-AI gate](https://docs.deep.space/design/anti-ai-gate):**
  - no hardcoded colors in JSX (status colors are theme tokens)
  - no fractional foreground opacity
  - no pictograph emoji
  - a 7-word hero headline

## Running it

```sh
npm install
npx deepspace auth login
npx deepspace dev start          # http://localhost:5173
npx vitest run                   # unit tests: scoring, brief parsing, reminders
npx deepspace test run e2e       # Playwright, incl. a two-user realtime flow
npx deepspace deploy
```

## Code map

- `src/schemas/rides-schema.ts`: collections and server-enforced permissions.
- `src/lib/weather.ts`: pure ride-window weather scoring (unit tested).
- `src/server/ride-ops.ts`: worker logic shared by actions and cron: scoring, stops, AI brief (prompt and validation), reminders.
- `src/actions/index.ts`, `src/cron.ts`: thin entry points onto `ride-ops`.
- `src/pages/(app)/home.tsx`: the ride board. `src/pages/(app)/(protected)/rides/[id].tsx`: the ride page.
- `tests/ride-flow.spec.ts`: two signed-in riders in separate browsers walk the whole flow, plus server-side guard checks.

## Next steps

- **Groups/clubs** with a `team` permission level, so rides are visible to a club rather than every signed-in user.
- **Wind** from a provider that has it, factored into the score ("20 mph headwind on the way home").
- **Calendar invite** on lock via the per-user Google Calendar integration.
- A **"brief is stale"** hint when votes change after the brief was generated.
