import { desktop, type DesktopBridge } from './desktop'

/**
 * Where the app keeps its settings: SQLite on the desktop, localStorage in a
 * plain browser.
 *
 * localStorage belongs to one origin, and the desktop app has had several:
 * the dev server (whose port has changed once already, losing every setting)
 * and the packaged app's file:// page each saw their own. The database sits
 * in the data folder beside the library, whatever loaded the page.
 *
 * The interface is localStorage's, synchronous, so zustand's persist and the
 * stores' own keys use it unchanged. On the desktop every setting is read in
 * one synchronous call when this module loads — before any store is created —
 * so the app starts with its settings instead of flashing the defaults.
 * Writes update the copy in memory at once and reach the database in the
 * background, a burst of them (a store saving several keys) in one message.
 */
export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * Everything that was kept in localStorage before, brought across on the
 * first run. Not the station library (libraryPersistence.ts moves that) or
 * the live-stream check, which only matters in a browser.
 */
const IMPORTED_KEYS = [
  'player.eq',
  'player.fx',
  'player.leveling',
  'player.table',
  'player.volume',
  'player.selectedId',
  'player.queueSource',
  'app.view',
  'local.expanded',
  'local.queueWidth',
]

/**
 * Set once per origin. Each origin had its own localStorage, so each is
 * imported on its first run, and only into keys the database does not have:
 * the first one to run wins, and a later one cannot overwrite it.
 */
function importedMarker(): string {
  return `$imported:${location.origin}`
}

function localStore(): SettingsStorage {
  // Every access guarded: storage can be disabled, full or unavailable.
  return {
    getItem: (key) => {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    setItem: (key, value) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // Settings are a convenience; losing one is not worth surfacing.
      }
    },
    removeItem: (key) => {
      try {
        localStorage.removeItem(key)
      } catch {
        // As above.
      }
    },
  }
}

function databaseStore(bridge: DesktopBridge, saved: Record<string, string>): SettingsStorage {
  const values = new Map(Object.entries(saved))
  let pending: Record<string, string | null> | null = null

  const queue = (key: string, value: string | null) => {
    if (!pending) {
      pending = {}
      queueMicrotask(() => {
        const changes = pending!
        pending = null
        bridge.settings.write(changes)
      })
    }
    pending[key] = value
  }

  const marker = importedMarker()
  if (!values.has(marker)) {
    const local = localStore()
    for (const key of IMPORTED_KEYS) {
      const value = local.getItem(key)
      if (value !== null && !values.has(key)) {
        values.set(key, value)
        queue(key, value)
      }
    }
    const now = new Date().toISOString()
    values.set(marker, now)
    queue(marker, now)
  }

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (values.get(key) === value) return
      values.set(key, value)
      queue(key, value)
    },
    removeItem: (key) => {
      if (!values.has(key)) return
      values.delete(key)
      queue(key, null)
    },
  }
}

function open(): SettingsStorage {
  if (!desktop) return localStore()
  let saved: Record<string, string> | null = null
  try {
    saved = desktop.settings.load()
  } catch (err) {
    console.error('[settings] could not load', err)
  }
  if (saved) return databaseStore(desktop, saved)
  // The database is unavailable; localStorage still has what it had.
  console.error('[settings] SQLite unavailable, using localStorage')
  return localStore()
}

export const settings: SettingsStorage = open()
