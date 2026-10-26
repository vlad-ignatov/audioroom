import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import db from '../../electron/library-db.cjs'
import { launch, tempDir, writeWav, type App } from './app'

let dataDir: string
let app: App | undefined

test.beforeEach(() => {
  dataDir = tempDir('e2e')
})

test.afterEach(async () => {
  await app?.electron.close()
  app = undefined
  fs.rmSync(dataDir, { recursive: true, force: true })
})

/** Settings as the app saved them, read straight from its database. */
function savedSettings(): Record<string, string> {
  const conn = new DatabaseSync(path.join(dataDir, 'library.sqlite'), { readOnly: true })
  try {
    const rows = conn.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  } finally {
    conn.close()
  }
}

test('starts on the station library, with the starter stations', async () => {
  app = await launch(dataDir)
  const { page, electron } = app

  await expect(page.getByRole('tab', { name: 'Internet radio' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('row').filter({ hasText: 'Capital FM' })).toBeVisible()

  const win = await electron.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    return { title: w.getTitle(), visible: w.isVisible() }
  })
  expect(win).toEqual({ title: 'AudioRoom', visible: false })
  expect(app.errors).toEqual([])
})

test('keeps settings in the database across a restart', async () => {
  app = await launch(dataDir)
  await app.page.getByRole('tab', { name: 'Local library' }).click()
  await expect.poll(() => savedSettings()['app.view']).toBe('local')
  await app.electron.close()

  app = await launch(dataDir)
  await expect(app.page.getByRole('tab', { name: 'Local library' })).toHaveAttribute('aria-selected', 'true')
  expect(app.errors).toEqual([])
})

test('serves local files over media:// with ranges', async () => {
  const file = path.join(dataDir, 'Music', 'tone.wav')
  writeWav(file, 1)
  app = await launch(dataDir)

  const url = `media://local${pathToFileURL(file).pathname}`
  const res = await app.page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { Range: 'bytes=0-3' } })
    return { status: r.status, range: r.headers.get('content-range'), body: await r.text() }
  }, url)
  expect(res).toEqual({ status: 206, range: `bytes 0-3/${fs.statSync(file).size}`, body: 'RIFF' })
})

test('plays a track from the local library', async () => {
  const music = path.join(dataDir, 'Music')
  writeWav(path.join(music, 'Test Tone.wav'), 4)
  // A library that already has the folder, as if added through the picker.
  db.open(path.join(dataDir, 'library.sqlite'))
  db.addFolder(music)
  db.writeSettings({ 'app.view': 'local' })
  db.close()

  app = await launch(dataDir)
  const { page } = app
  // By title, not a CSS selector: Windows paths are full of backslashes.
  const folder = page.getByRole('row').and(page.getByTitle(music, { exact: true }))
  await folder.click()
  await expect(folder).toHaveAttribute('aria-expanded', 'true')

  await page.getByRole('row').and(page.getByTitle('Test Tone.wav', { exact: true })).dblclick()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  // The position moves: the file is actually decoding and playing.
  const position = page.locator('[aria-label="Position"]').first()
  await expect(position).toHaveAttribute('aria-valuetext', /^0:0[1-4] of 0:04$/, { timeout: 15_000 })
  expect(app.errors).toEqual([])
})
