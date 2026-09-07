import { useMemo } from 'react'
import type { Station } from '@/types/station'
import { useLibrary } from '@/store/library'
import { useTable, type ColumnId, type Filters } from '@/store/table'
import { normalize } from '@/lib/utils'

/** Rank used when sorting by the `quality` column. */
const CAPABILITY_RANK: Record<Station['capability'], number> = {
  full: 0,
  unknown: 1,
  'playback-only': 2,
  unavailable: 3,
}

function matches(s: Station, f: Filters, q: string): boolean {
  if (f.favoritesOnly && !s.favorite) return false
  if (f.capability !== 'any' && s.capability !== f.capability) return false
  if (f.tags.length > 0 && !f.tags.some((t) => s.tags.includes(t))) return false
  if (f.countries.length > 0 && !(s.country && f.countries.includes(s.country))) return false
  if (f.codecs.length > 0 && !(s.codec && f.codecs.includes(s.codec))) return false
  if (q) {
    const haystack = normalize(
      [s.name, s.country, s.language, s.codec, s.notes, ...s.tags].filter(Boolean).join(' '),
    )
    // Every whitespace-separated term must appear, so "jazz paris" narrows.
    return q.split(/\s+/).every((term) => haystack.includes(term))
  }
  return true
}

function valueFor(s: Station, id: ColumnId): string | number {
  switch (id) {
    case 'favorite':
      return s.favorite ? 0 : 1
    case 'name':
      return normalize(s.name)
    case 'quality':
      return CAPABILITY_RANK[s.capability]
    case 'country':
      return normalize(s.country ?? '￿')
    case 'language':
      return normalize(s.language ?? '￿')
    case 'codec':
      return normalize(s.codec ?? '￿')
    case 'bitrate':
      return s.bitrate ?? -1
    case 'votes':
      return s.votes ?? -1
    case 'playCount':
      return s.playCount
    case 'lastPlayedAt':
      return s.lastPlayedAt ?? 0
    default:
      return 0
  }
}

export function useVisibleStations(): Station[] {
  const stations = useLibrary((s) => s.stations)
  const filters = useTable((s) => s.filters)
  const sort = useTable((s) => s.sort)

  return useMemo(() => {
    const q = normalize(filters.query.trim())
    const rows = stations.filter((s) => matches(s, filters, q))
    if (sort.length === 0) return rows

    return rows.slice().sort((a, b) => {
      for (const key of sort) {
        const av = valueFor(a, key.id)
        const bv = valueFor(b, key.id)
        if (av === bv) continue
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
        return key.dir === 'asc' ? cmp : -cmp
      }
      return 0
    })
  }, [stations, filters, sort])
}

export interface Facet {
  value: string
  count: number
}

export function useFacets() {
  const stations = useLibrary((s) => s.stations)
  return useMemo(() => {
    const tally = (pick: (s: Station) => string[]) => {
      const map = new Map<string, number>()
      for (const s of stations) {
        for (const v of pick(s)) {
          if (v) map.set(v, (map.get(v) ?? 0) + 1)
        }
      }
      return [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    }
    return {
      tags: tally((s) => s.tags),
      countries: tally((s) => (s.country ? [s.country] : [])),
      codecs: tally((s) => (s.codec ? [s.codec] : [])),
    }
  }, [stations])
}
