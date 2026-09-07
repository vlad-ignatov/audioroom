import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { COLUMNS, useTable } from '@/store/table'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useVisibleStations } from '@/hooks/useVisibleStations'
import type { Station } from '@/types/station'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { StationRow } from './StationRow'
import { cn } from '@/lib/utils'

interface Props {
  onEditStation: (s: Station) => void
  onBrowseDirectory: () => void
}

export function StationTable({ onEditStation, onBrowseDirectory }: Props) {
  const rows = useVisibleStations()
  const columns = useTable((s) => s.columns)
  const sort = useTable((s) => s.sort)
  const manualOrder = useTable((s) => s.manualOrder)
  const cycleSort = useTable((s) => s.cycleSort)
  const filters = useTable((s) => s.filters)
  const clearFilters = useTable((s) => s.clearFilters)

  const { toggleFavorite, removeStation, moveStation, stations } = useLibrary()
  const { selectedId, status, toggle, setQueue } = usePlayer()

  const scrollRef = useRef<HTMLDivElement>(null)
  const dragId = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const template = useMemo(
    () => columns.map((id) => COLUMNS[id].width).join(' '),
    [columns],
  )

  /**
   * The width below which the columns can no longer shrink.
   *
   * Every column is either a fixed pixel width or a `minmax()` with a pixel
   * floor, so the grid has a hard minimum — around 1200px with the default
   * columns, which is wider than the smallest allowed window. Without an
   * explicit min-width the grid silently overflows its container instead of
   * scrolling. Derived from COLUMNS so adding a column cannot desynchronise it.
   */
  const minWidth = useMemo(() => {
    const GAP = 12 // gap-3
    const PADDING = 24 // px-3, both sides
    const floors = columns.reduce((sum, id) => {
      const width = COLUMNS[id].width
      const match = /^minmax\(\s*(\d+)px/.exec(width) ?? /^(\d+)px$/.exec(width)
      return sum + (match ? Number(match[1]) : 0)
    }, 0)
    return floors + Math.max(0, columns.length - 1) * GAP + PADDING
  }, [columns])

  // Next/previous should follow whatever the user is looking at, not the
  // library's storage order.
  useEffect(() => {
    setQueue(rows.map((r) => r.id))
  }, [rows, setQueue])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 10,
  })

  const filtersActive =
    filters.query !== '' ||
    filters.favoritesOnly ||
    filters.tags.length > 0 ||
    filters.countries.length > 0 ||
    filters.codecs.length > 0 ||
    filters.capability !== 'any'

  const canDrag = manualOrder && !filtersActive

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* One scroller for both axes: the header must move with the rows when
          the table is wider than the window, so they cannot scroll separately. */}
      <div
        ref={scrollRef}
        className={cn(
          'overflow-auto scrollbar-thin',
          rows.length === 0 ? 'shrink-0' : 'min-h-0 flex-1',
        )}
      >
        <div style={{ minWidth }}>
          <div
            role="row"
            style={{ gridTemplateColumns: template }}
            className="sticky top-0 z-20 grid h-9 items-center gap-3 border-b border-line bg-bg-raised px-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint"
          >
        {columns.map((id) => {
          const col = COLUMNS[id]
          const sortIndex = sort.findIndex((s) => s.id === id)
          const active = sortIndex >= 0
          return (
            <button
              key={id}
              type="button"
              disabled={!col.sortable}
              onClick={(e) => cycleSort(id, e.shiftKey)}
              className={cn(
                'flex items-center gap-1 truncate text-left',
                col.numeric && 'justify-start',
                col.sortable ? 'hover:text-ink-dim' : 'cursor-default',
                active && 'text-accent',
              )}
              title={col.sortable ? 'Click to sort, shift-click to add a second key' : undefined}
            >
              {col.label}
              {active && (
                <>
                  <Icon name={sort[sortIndex]!.dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={11} />
                  {sort.length > 1 && <span className="text-[9px]">{sortIndex + 1}</span>}
                </>
              )}
            </button>
          )
        })}
          </div>

          {rows.length > 0 && (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const station = rows[item.index]!
              return (
                <div
                  key={station.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                  className={cn(
                    dragOverId === station.id && 'border-t-2 border-t-accent',
                  )}
                >
                  <StationRow
                    station={station}
                    columns={columns}
                    template={template}
                    isSelected={selectedId === station.id}
                    isPlaying={status === 'playing' || status === 'buffering'}
                    draggable={canDrag}
                    onPlay={() => void toggle(station)}
                    onToggleFavorite={() => toggleFavorite(station.id)}
                    onEdit={() => onEditStation(station)}
                    onRemove={() => removeStation(station.id)}
                    onDragStart={() => {
                      dragId.current = station.id
                    }}
                    onDragOver={(e) => {
                      if (!canDrag || !dragId.current) return
                      e.preventDefault()
                      setDragOverId(station.id)
                    }}
                    onDrop={() => {
                      const source = dragId.current
                      setDragOverId(null)
                      dragId.current = null
                      if (!source || source === station.id) return
                      const target = stations.findIndex((s) => s.id === station.id)
                      if (target >= 0) moveStation(source, target)
                    }}
                  />
                </div>
              )
            })}
            </div>
          )}
        </div>
      </div>

      {rows.length === 0 && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-ink-dim">
            {filtersActive ? 'No stations match these filters.' : 'Your library is empty.'}
          </p>
          {filtersActive ? (
            <Button variant="solid" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : (
            <Button variant="accent" onClick={onBrowseDirectory}>
              <Icon name="search" size={14} />
              Browse the directory
            </Button>
          )}
        </div>
      )}

      <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-line-soft px-3 text-[11px] text-ink-faint">
        <span>
          {rows.length} of {stations.length} station{stations.length === 1 ? '' : 's'}
        </span>
        {canDrag && <span>Drag rows to reorder</span>}
        {!canDrag && manualOrder && <span>Clear filters to reorder</span>}
        {sort.length > 0 && (
          <button type="button" onClick={useTable.getState().clearSort} className="hover:text-ink-dim">
            Sorted by {sort.map((s) => COLUMNS[s.id].label || 'favourite').join(', ')} — clear
          </button>
        )}
      </footer>
    </div>
  )
}
