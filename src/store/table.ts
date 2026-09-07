import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Capability } from '@/types/station'

export type ColumnId =
  | 'favorite'
  | 'name'
  | 'quality'
  | 'tags'
  | 'country'
  | 'language'
  | 'codec'
  | 'bitrate'
  | 'votes'
  | 'playCount'
  | 'lastPlayedAt'

export interface ColumnDef {
  id: ColumnId
  label: string
  /** CSS grid track size. */
  width: string
  sortable: boolean
  numeric?: boolean
}

export const COLUMNS: Record<ColumnId, ColumnDef> = {
  favorite: { id: 'favorite', label: '', width: '32px', sortable: true },
  name: { id: 'name', label: 'Station', width: 'minmax(180px, 2.2fr)', sortable: true },
  quality: { id: 'quality', label: 'Audio', width: '108px', sortable: true },
  tags: { id: 'tags', label: 'Tags', width: 'minmax(120px, 1.4fr)', sortable: false },
  country: { id: 'country', label: 'Country', width: 'minmax(110px, 1fr)', sortable: true },
  language: { id: 'language', label: 'Language', width: '110px', sortable: true },
  codec: { id: 'codec', label: 'Codec', width: '78px', sortable: true },
  bitrate: { id: 'bitrate', label: 'Bitrate', width: '84px', sortable: true, numeric: true },
  votes: { id: 'votes', label: 'Votes', width: '76px', sortable: true, numeric: true },
  playCount: { id: 'playCount', label: 'Plays', width: '68px', sortable: true, numeric: true },
  lastPlayedAt: { id: 'lastPlayedAt', label: 'Last played', width: '104px', sortable: true, numeric: true },
}

export const ALL_COLUMN_IDS = Object.keys(COLUMNS) as ColumnId[]

const DEFAULT_VISIBLE: ColumnId[] = [
  'favorite', 'name', 'quality', 'tags', 'country', 'bitrate', 'lastPlayedAt',
]

export type SortDir = 'asc' | 'desc'
export interface SortKey {
  id: ColumnId
  dir: SortDir
}

export interface Filters {
  query: string
  favoritesOnly: boolean
  tags: string[]
  countries: string[]
  codecs: string[]
  capability: Capability | 'any'
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  favoritesOnly: false,
  tags: [],
  countries: [],
  codecs: [],
  capability: 'any',
}

export interface SavedView {
  id: string
  name: string
  filters: Filters
  sort: SortKey[]
  columns: ColumnId[]
}

interface TableState {
  columns: ColumnId[]
  sort: SortKey[]
  filters: Filters
  savedViews: SavedView[]
  /** Manual drag order wins until the user picks a sort column. */
  manualOrder: boolean

  toggleColumn: (id: ColumnId) => void
  moveColumn: (id: ColumnId, delta: number) => void
  resetColumns: () => void
  /** Click a header: cycles asc → desc → off. Additive with shift for multi-key sort. */
  cycleSort: (id: ColumnId, additive: boolean) => void
  clearSort: () => void
  setFilters: (patch: Partial<Filters>) => void
  clearFilters: () => void
  toggleFilterValue: (key: 'tags' | 'countries' | 'codecs', value: string) => void
  saveView: (name: string) => void
  applyView: (id: string) => void
  deleteView: (id: string) => void
}

export const useTable = create<TableState>()(
  persist(
    (set, get) => ({
      columns: DEFAULT_VISIBLE,
      sort: [],
      filters: EMPTY_FILTERS,
      savedViews: [],
      manualOrder: true,

      toggleColumn: (id) =>
        set((st) => {
          if (st.columns.includes(id)) {
            if (id === 'name') return st // the name column is not optional
            return { columns: st.columns.filter((c) => c !== id) }
          }
          // Re-inserting restores the canonical position rather than appending.
          const next = ALL_COLUMN_IDS.filter(
            (c) => c === id || st.columns.includes(c),
          )
          return { columns: next }
        }),

      moveColumn: (id, delta) =>
        set((st) => {
          const i = st.columns.indexOf(id)
          const j = i + delta
          if (i < 0 || j < 0 || j >= st.columns.length) return st
          const next = st.columns.slice()
          ;[next[i], next[j]] = [next[j]!, next[i]!]
          return { columns: next }
        }),

      resetColumns: () => set({ columns: DEFAULT_VISIBLE }),

      cycleSort: (id, additive) =>
        set((st) => {
          const existing = st.sort.find((s) => s.id === id)
          const rest = additive ? st.sort.filter((s) => s.id !== id) : []
          if (!existing) return { sort: [...rest, { id, dir: 'asc' as SortDir }], manualOrder: false }
          if (existing.dir === 'asc') {
            return { sort: [...rest, { id, dir: 'desc' as SortDir }], manualOrder: false }
          }
          const sort = rest
          return { sort, manualOrder: sort.length === 0 }
        }),

      clearSort: () => set({ sort: [], manualOrder: true }),

      setFilters: (patch) => set((st) => ({ filters: { ...st.filters, ...patch } })),
      clearFilters: () => set({ filters: EMPTY_FILTERS }),

      toggleFilterValue: (key, value) =>
        set((st) => {
          const current = st.filters[key]
          const next = current.includes(value)
            ? current.filter((v) => v !== value)
            : [...current, value]
          return { filters: { ...st.filters, [key]: next } }
        }),

      saveView: (name) =>
        set((st) => ({
          savedViews: [
            ...st.savedViews,
            {
              id: crypto.randomUUID(),
              name: name.trim() || 'Untitled view',
              filters: st.filters,
              sort: st.sort,
              columns: st.columns,
            },
          ],
        })),

      applyView: (id) => {
        const view = get().savedViews.find((v) => v.id === id)
        if (!view) return
        set({
          filters: view.filters,
          sort: view.sort,
          columns: view.columns,
          manualOrder: view.sort.length === 0,
        })
      },

      deleteView: (id) =>
        set((st) => ({ savedViews: st.savedViews.filter((v) => v.id !== id) })),
    }),
    { name: 'player.table', version: 1 },
  ),
)
