import { memo } from 'react'
import type { Station } from '@/types/station'
import type { ColumnId } from '@/store/table'
import { Icon } from '@/components/ui/Icon'
import { cn, formatRelative } from '@/lib/utils'

interface Props {
  station: Station
  columns: ColumnId[]
  template: string
  /** The station the listener has chosen; stays true while paused or stopped. */
  isSelected: boolean
  /** True only while this station is actually producing audio. */
  isPlaying: boolean
  draggable: boolean
  onPlay: () => void
  onToggleFavorite: () => void
  onEdit: () => void
  onRemove: () => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
}

function Cell({ id, station }: { id: ColumnId; station: Station }) {
  switch (id) {
    case 'tags':
      return (
        <div className="flex gap-1 overflow-hidden">
          {station.tags.slice(0, 3).map((t) => (
            <span
              key={t}
              className="truncate rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-faint"
            >
              {t}
            </span>
          ))}
        </div>
      )
    case 'country':
      return <span className="truncate text-ink-dim">{station.country ?? '–'}</span>
    case 'language':
      return <span className="truncate capitalize text-ink-dim">{station.language ?? '–'}</span>
    case 'codec':
      return <span className="font-mono text-[11px] text-ink-dim">{station.codec ?? '–'}</span>
    case 'bitrate':
      return (
        <span className="tabular-nums text-ink-dim">
          {station.bitrate ? `${station.bitrate}k` : '–'}
        </span>
      )
    case 'votes':
      return <span className="tabular-nums text-ink-dim">{station.votes ?? '–'}</span>
    case 'playCount':
      return <span className="tabular-nums text-ink-dim">{station.playCount || '–'}</span>
    case 'lastPlayedAt':
      return <span className="truncate text-ink-faint">{formatRelative(station.lastPlayedAt)}</span>
    default:
      return null
  }
}

export const StationRow = memo(function StationRow({
  station,
  columns,
  template,
  isSelected,
  isPlaying,
  draggable,
  onPlay,
  onToggleFavorite,
  onEdit,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
}: Props) {
  return (
    <div
      role="row"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDoubleClick={onPlay}
      style={{ gridTemplateColumns: template }}
      className={cn(
        'group grid min-h-8 items-center gap-3 border-b py-1 border-line-soft px-3 text-[13px] outline-none',
        'hover:bg-bg-raised focus-visible:bg-bg-raised',
        isSelected && 'bg-accent/8',
        station.capability === 'unavailable' && 'opacity-55',
      )}
    >
      {columns.map((id) => {
        if (id === 'favorite') {
          return (
            <button
              key={id}
              type="button"
              aria-label={station.favorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={station.favorite}
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite()
              }}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded transition-colors',
                station.favorite
                  ? 'text-accent'
                  : 'text-transparent group-hover:text-ink-faint hover:!text-accent',
              )}
            >
              <Icon name="star" size={14} />
            </button>
          )
        }

        if (id === 'name') {
          return (
            <div key={id} className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                aria-label={
                  isSelected && isPlaying ? `Pause ${station.name}` : `Play ${station.name}`
                }
                onClick={onPlay}
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                  isSelected
                    ? 'border-accent bg-accent text-bg'
                    : 'border-line text-ink-dim opacity-0 group-hover:opacity-100 hover:border-accent hover:text-accent',
                )}
              >
                <Icon name={isSelected && isPlaying ? 'pause' : 'play'} size={12} />
              </button>
              <span
                className="h-2.5 w-1 shrink-0 rounded-full"
                style={{ background: station.color ?? 'transparent' }}
              />
              <div className="min-w-0">
                <div className={cn('truncate', isSelected ? 'text-accent' : 'text-ink')}>
                  {station.name}
                </div>
                {station.notes && (
                  <div className="truncate text-[11px] text-ink-faint">{station.notes}</div>
                )}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`Edit ${station.name}`}
                  onClick={onEdit}
                  className="rounded p-1 text-ink-faint hover:bg-panel hover:text-ink"
                >
                  <Icon name="edit" size={13} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${station.name}`}
                  onClick={onRemove}
                  className="rounded p-1 text-ink-faint hover:bg-panel hover:text-bad"
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </div>
          )
        }

        return (
          <div key={id} className="min-w-0 truncate">
            <Cell id={id} station={station} />
          </div>
        )
      })}
    </div>
  )
})
