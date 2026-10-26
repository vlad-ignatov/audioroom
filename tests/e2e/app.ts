import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')

export interface App {
  electron: ElectronApplication
  page: Page
  /** Uncaught errors in the interface; a test fails if any appear. */
  errors: Error[]
  /** Everything the interface logged, attached to a failed test's report. */
  console: string[]
}

/** A fresh, empty data folder, removed by the caller. */
export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `audioroom-${prefix}-`))
}

/**
 * Start the app on a data folder of the test's own, never the user's. The
 * window stays hidden (AUDIOROOM_TEST), so a local run doesn't take focus.
 */
export async function launch(dataDir: string): Promise<App> {
  const env: Record<string, string> = { AUDIOROOM_TEST: '1', AUDIOROOM_DATA_DIR: dataDir }
  for (const [key, value] of Object.entries(process.env)) {
    // Set by some editors' terminals; it would start Electron as plain Node.
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] ??= value
  }
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env })
  const page = await app.firstWindow()
  const errors: Error[] = []
  const console: string[] = []
  page.on('pageerror', (err) => errors.push(err))
  page.on('console', (msg) => console.push(`[${msg.type()}] ${msg.text()}`))
  // The main process's output, which Playwright otherwise discards.
  app.process().stdout?.on('data', (d: Buffer) => console.push(`[main] ${d.toString().trimEnd()}`))
  app.process().stderr?.on('data', (d: Buffer) => console.push(`[main:err] ${d.toString().trimEnd()}`))
  await page.waitForLoadState('domcontentloaded')
  return { electron: app, page, errors, console }
}

/** A mono 16-bit WAV of a quiet sine, `seconds` long. */
export function writeWav(file: string, seconds: number): void {
  const rate = 22050
  const samples = Math.round(rate * seconds)
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write('RIFF', 0, 'latin1')
  buf.writeUInt32LE(36 + samples * 2, 4)
  buf.write('WAVEfmt ', 8, 'latin1')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'latin1')
  buf.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buf)
}
