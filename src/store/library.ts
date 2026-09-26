import { create } from 'zustand'
import type { Capability, Station } from '@/types/station'
import { uid } from '@/lib/utils'
import { seedStations } from './seed'

export function urlKey(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase()
}

/**
 * Drop entries that repeat an id or a URL, keeping the first (which carries any
 * edits the listener already made).
 *
 * Both keys matter. Rows are keyed by `id` in React, but a directory station
 * can come back under a slightly different URL — extra tracking parameters, a
 * trailing slash — so matching on URL alone lets a second copy through with an
 * identical id. React then renders both into one node and the rows appear
 * painted on top of each other.
 */
export function dedupe(stations: Station[]): Station[] {
  const ids = new Set<string>()
  const urls = new Set<string>()
  const out: Station[] = []
  for (const station of stations) {
    const key = urlKey(station.url)
    if (ids.has(station.id) || urls.has(key)) continue
    ids.add(station.id)
    urls.add(key)
    out.push(station)
  }
  return out
}

/**
 * Fold a station from an imported library into the one already here.
 *
 * The import is the listener's other machine, so what they did there wins:
 * name, favourite, notes, colour, tags. Counters combine rather than
 * overwrite, and loudness goes to whichever reading is newer. What this
 * machine learned about *reaching* the station — the capability verdict and
 * any rewritten URL — stays, since it is a fact about this network and build.
 */
function mergeStation(local: Station, imported: Station): Station {
  const importedLoudnessNewer = (imported.loudnessMeasuredAt ?? 0) > (local.loudnessMeasuredAt ?? 0)
  const latest = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b))
  return {
    ...local,
    ...imported,
    id: local.id,
    url: local.url,
    capability: local.capability,
    capabilityCheckedAt: local.capabilityCheckedAt,
    capabilityReason: local.capabilityReason,
    resolvedUrl: local.resolvedUrl,
    addedAt: Math.min(local.addedAt, imported.addedAt ?? local.addedAt),
    lastPlayedAt: latest(local.lastPlayedAt, imported.lastPlayedAt),
    playCount: Math.max(local.playCount, imported.playCount ?? 0),
    loudnessLufs: importedLoudnessNewer ? imported.loudnessLufs : local.loudnessLufs,
    loudnessMeasuredAt: importedLoudnessNewer ? imported.loudnessMeasuredAt : local.loudnessMeasuredAt,
  }
}

/** Field-by-field equality; key order differs between merged and stored rows. */
function sameStation(a: Station, b: Station): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Station)[])
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false
  }
  return true
}

export type ImportMode = 'merge' | 'replace'

interface LibraryState {
  stations: Station[]
  /** Adds stations, skipping any whose URL is already present. Returns how many landed. */
  addStations: (incoming: Station[]) => number
  removeStation: (id: string) => void
  updateStation: (id: string, patch: Partial<Station>) => void
  toggleFavorite: (id: string) => void
  moveStation: (id: string, toIndex: number) => void
  markPlayed: (id: string) => void
  recordCapability: (id: string, capability: Capability, url: string, reason?: string) => void
  recordLoudness: (id: string, lufs: number) => void
  replaceAll: (stations: Station[]) => void
  /**
   * Bring in a library exported elsewhere. Merge matches stations by URL and
   * updates them (see mergeStation), adding the rest; replace swaps the whole
   * library for the import.
   */
  importStations: (incoming: Station[], mode: ImportMode) => { added: number; updated: number }
  resetToSeed: () => void
  hasUrl: (url: string) => boolean
}

/**
 * The station library.
 *
 * Starts empty: persistence lives in ./libraryPersistence, which loads the
 * saved library (SQLite on desktop, localStorage in a browser) before the app
 * first renders and saves every change after that.
 */
export const useLibrary = create<LibraryState>()(
  (set, get) => ({
    stations: [],

    addStations: (incoming) => {
      const current = get().stations
      const ids = new Set(current.map((s) => s.id))
      const urls = new Set(current.map((s) => urlKey(s.url)))
      const fresh = incoming.filter((s) => {
        const key = urlKey(s.url)
        if (ids.has(s.id) || urls.has(key)) return false
        ids.add(s.id)
        urls.add(key)
        return true
      })
      if (fresh.length > 0) set((st) => ({ stations: [...st.stations, ...fresh] }))
      return fresh.length
    },

    removeStation: (id) =>
      set((st) => ({ stations: st.stations.filter((s) => s.id !== id) })),

    updateStation: (id, patch) =>
      set((st) => ({
        stations: st.stations.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      })),

    toggleFavorite: (id) =>
      set((st) => ({
        stations: st.stations.map((s) =>
          s.id === id ? { ...s, favorite: !s.favorite } : s,
        ),
      })),

    moveStation: (id, toIndex) =>
      set((st) => {
        const from = st.stations.findIndex((s) => s.id === id)
        if (from < 0 || toIndex < 0 || toIndex >= st.stations.length) return st
        const next = st.stations.slice()
        const [moved] = next.splice(from, 1)
        next.splice(toIndex, 0, moved!)
        return { stations: next }
      }),

    markPlayed: (id) =>
      set((st) => ({
        stations: st.stations.map((s) =>
          s.id === id
            ? { ...s, lastPlayedAt: Date.now(), playCount: s.playCount + 1 }
            : s,
        ),
      })),

    recordCapability: (id, capability, url, reason) =>
      set((st) => ({
        stations: st.stations.map((s) =>
          s.id === id
            ? {
                ...s,
                capability,
                capabilityCheckedAt: Date.now(),
                capabilityReason: reason,
                resolvedUrl: url !== s.url ? url : undefined,
              }
            : s,
        ),
      })),

    /**
     * Remember a station's measured loudness.
     *
     * Smoothed against the stored value rather than overwritten: a single
     * play may land on an unusually loud or quiet stretch, and levelling
     * should converge on the station's typical level, not the last song's.
     */
    recordLoudness: (id, lufs) =>
      set((st) => ({
        stations: st.stations.map((s) => {
          if (s.id !== id) return s
          const previous = s.loudnessLufs
          const blended = previous === undefined ? lufs : previous * 0.7 + lufs * 0.3
          return { ...s, loudnessLufs: blended, loudnessMeasuredAt: Date.now() }
        }),
      })),

    replaceAll: (stations) => set({ stations }),

    importStations: (incoming, mode) => {
      const clean = dedupe(incoming)
      if (mode === 'replace') {
        set({ stations: clean })
        return { added: clean.length, updated: 0 }
      }
      const next = get().stations.slice()
      const byUrl = new Map(next.map((s, i) => [urlKey(s.url), i]))
      const ids = new Set(next.map((s) => s.id))
      let added = 0
      let updated = 0
      for (const station of clean) {
        const at = byUrl.get(urlKey(station.url))
        if (at !== undefined) {
          const merged = mergeStation(next[at]!, station)
          // Unchanged rows keep their identity, so nothing is written for them.
          if (!sameStation(merged, next[at]!)) {
            next[at] = merged
            updated++
          }
          continue
        }
        const fresh = ids.has(station.id) ? { ...station, id: uid() } : station
        ids.add(fresh.id)
        byUrl.set(urlKey(fresh.url), next.length)
        next.push(fresh)
        added++
      }
      if (added > 0 || updated > 0) set({ stations: next })
      return { added, updated }
    },

    resetToSeed: () => set({ stations: seedStations() }),
    hasUrl: (url) => get().stations.some((s) => urlKey(s.url) === urlKey(url)),
  }),
)
