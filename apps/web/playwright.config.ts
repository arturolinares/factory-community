import { defineConfig } from '@playwright/test'
import { defineBddConfig } from 'playwright-bdd'

/**
 * The browser layer.
 *
 * A real browser is worth the cost here and not below it: everything under the
 * UI is already specified without one, so these scenarios exist to check that
 * what is rendered matches what the API said — the one thing a unit test of
 * either half cannot tell you.
 */
const testDir = defineBddConfig({
  features: ['features/*.feature'],
  steps: ['features/steps/*.ts'],
})

export default defineConfig({
  testDir,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5317',
    trace: 'retain-on-failure',
    // Granted so a scenario can read back what a copy button put on the
    // clipboard. Without it Chromium's prompt is auto-denied and a copy that
    // works in a real browser looks broken here — the assertion would pass or
    // fail for a reason that has nothing to do with the page.
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    // Vite only. Each scenario starts its own daemon against its own temporary
    // scopes, so the suite never touches the developer's real ~/.factory.
    // --host 127.0.0.1 explicitly. Vite's default binding announces itself as
    // "localhost", which on current macOS resolves to ::1 first, so polling
    // 127.0.0.1 never succeeds and the wait times out with no useful message.
    // Exactly the trap the proxy comment in vite.config.ts warns about.
    command: 'pnpm exec vite --host 127.0.0.1 --port 5317 --strictPort',
    url: 'http://127.0.0.1:5317',
    // Reuse a dev server that is already up rather than failing the whole run
    // with "port already in use". The suite creates its own scopes and its own
    // daemon per scenario, so it does not care whose Vite is serving the page —
    // and a leftover server from an interrupted run used to block everything
    // with an error that looks nothing like the real cause.
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
