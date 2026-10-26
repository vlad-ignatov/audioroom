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
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { trace: 'retain-on-failure' },
  outputDir: 'test-results',
})
