/**
 * Run the end-to-end flow against the deployed app instead of local dev:
 *
 *   npx playwright test -c tests/playwright.prod.config.ts ride-flow
 *
 * No webServer: it targets $REGROUP_URL (default https://regroup.app.space).
 * Uses the same test accounts as local runs; the spec cleans up its ride.
 */
import { defineConfig } from '@playwright/test'
import { chromiumLaunchOptions } from 'deepspace/testing'

export default defineConfig({
  testDir: '.',
  testMatch: '**/ride-flow.spec.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.REGROUP_URL ?? 'https://regroup.app.space',
    headless: true,
    launchOptions: chromiumLaunchOptions(),
  },
})
