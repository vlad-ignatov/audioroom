import { defineConfig } from '@playwright/test'

// End-to-end tests: the real app, built, driven through Playwright's
// Electron support. Run `npm run build` first (npm run test:e2e does).
export default defineConfig({
  testDir: 'tests/e2e',
  // Each test starts its own app; one at a time keeps a slow CI runner calm.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  // Once, on CI only. Playback on the Windows runner failed one run in five
  // without a trace of why; a retry keeps that from failing the build, and
  // the report still marks the test flaky, with the first attempt's console
  // in test-results.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { trace: 'retain-on-failure' },
  outputDir: 'test-results',
})
