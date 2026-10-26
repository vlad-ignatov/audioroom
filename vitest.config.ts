import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Unit tests for the interface's logic (tests/unit) and the main process
// (tests/main), all in plain Node: nothing here needs a window or Electron.
// The end-to-end tests in tests/e2e run the real app through Playwright.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/main/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/electron-download.ts'],
  },
})
