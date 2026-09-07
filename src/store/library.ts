import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Capability, Station } from '@/types/station'
import { seedStations } from './seed'

function urlKey(url: string): string {
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
function dedupe(stations: Station[]): Station[] {
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
  resetToSeed: () => void
  hasUrl: (url: string) => boolean
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      stations: seedStations(),

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
      resetToSeed: () => set({ stations: seedStations() }),
      hasUrl: (url) => get().stations.some((s) => urlKey(s.url) === urlKey(url)),
    }),
    {
      name: 'player.library',
      version: 2,
      // Libraries saved before the id check existed can already hold duplicates;
      // repair them on load rather than leaving rows overlapping.
      migrate: (persisted) => {
        const old = (persisted ?? {}) as { stations?: Station[] }
        return { stations: dedupe(old.stations ?? seedStations()) } as LibraryState
      },
    },
  ),
)
