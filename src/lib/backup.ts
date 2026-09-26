import type { Station } from '@/types/station'
import type { EqPreset } from '@/audio/eq'
import { useEq } from '@/store/eq'
import { useFx } from '@/store/fx'
import { useLeveling } from '@/store/leveling'
import { parsePlaylist } from './playlist'

/**
 * A whole-app backup: the library plus the sound setup, for moving between
 * machines (a Mac and a Linux box, say).
 *
 * Settings travel as the stores' own persisted blobs (`{ state, version }`),
 * so restoring one is exactly a reload of that store: its migrations run on
 * an older blob, and it pushes the values into the audio engine itself.
 * Table layout and volume stay behind; they belong to the screen and the
 * speakers of the machine they were set on.
 */
const SETTINGS = {
  'player.eq': useEq,
  'player.fx': useFx,
  'player.leveling': useLeveling,
} as const

type SettingsKey = keyof typeof SETTINGS
type Persisted = { state: Record<string, unknown>; version?: number }

export interface Backup {
  stations: Station[]
  settings: Partial<Record<SettingsKey, Persisted>>
}

export function createBackup(stations: Station[]): string {
  const settings: Backup['settings'] = {}
  for (const key of Object.keys(SETTINGS) as SettingsKey[]) {
    const raw = localStorage.getItem(key)
    if (raw) settings[key] = JSON.parse(raw) as Persisted
  }
  return JSON.stringify(
    { format: 'player-backup', version: 2, exportedAt: new Date().toISOString(), stations, settings },
    null,
    2,
  )
}

/**
 * Read a backup, or an older stations-only JSON export (which simply has no
 * settings). Throws on anything that is not JSON.
 */
export function parseBackup(text: string): Backup {
  const data = JSON.parse(text) as { settings?: Backup['settings'] }
  return { stations: parsePlaylist(text), settings: data?.settings ?? {} }
}

export function presetsIn(backup: Backup): EqPreset[] {
  const presets = backup.settings['player.eq']?.state.customPresets
  return Array.isArray(presets) ? (presets as EqPreset[]) : []
}

/**
 * Apply a backup's settings.
 *
 * EQ presets are always merged by name — a preset made on either machine is
 * worth keeping. The rest of the sound setup (EQ curve and on/off, effects,
 * auto level) replaces this machine's only when `sound` is set.
 */
export async function restoreSettings(backup: Backup, { sound }: { sound: boolean }): Promise<void> {
  const eqBlob = backup.settings['player.eq']
  const ids = useEq.getState().mergePresets(presetsIn(backup))
  if (!sound) return

  if (eqBlob) {
    const active = eqBlob.state.activePresetId
    const local = useEq.getState()
    await rehydrate('player.eq', {
      ...eqBlob,
      state: {
        ...eqBlob.state,
        // The merged list, not the other machine's, and ids as merged.
        customPresets: local.customPresets,
        activePresetId: typeof active === 'string' ? (ids.get(active) ?? active) : null,
        // Whether the drawer is open is this screen's business.
        panelOpen: local.panelOpen,
      },
    })
  }
  for (const key of ['player.fx', 'player.leveling'] as const) {
    const blob = backup.settings[key]
    if (blob) await rehydrate(key, blob)
  }
}

async function rehydrate(key: SettingsKey, blob: Persisted): Promise<void> {
  localStorage.setItem(key, JSON.stringify(blob))
  await SETTINGS[key].persist.rehydrate()
}

// ---- local files from another machine ------------------------------------

/**
 * The deepest folder containing all of these `file://` URLs, as a URL ending
 * in `/` — e.g. `file:///Users/vlad/Music/`.
 */
export function commonFolder(urls: string[]): string {
  const dirs = urls.map((u) => u.split('/').slice(0, -1))
  let n = dirs[0]?.length ?? 0
  for (const parts of dirs) {
    let i = 0
    while (i < n && parts[i] === dirs[0]![i]) i++
    n = i
  }
  return `${dirs[0]!.slice(0, n).join('/')}/`
}

/** `file:///Users/vlad/My%20Music/` → `/Users/vlad/My Music` for display. */
export function folderLabel(url: string): string {
  const path = decodeURIComponent(new URL(url).pathname)
  return path.length > 1 ? path.replace(/\/$/, '') : path
}

/** Point every station under `from` at the same place under `to`. */
export function remapFolder(stations: Station[], from: string, to: string, only: Set<string>): Station[] {
  return stations.map((s) =>
    only.has(s.url) && s.url.startsWith(from) ? { ...s, url: to + s.url.slice(from.length) } : s,
  )
}
