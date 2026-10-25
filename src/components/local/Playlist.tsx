import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { LooseFileEntry, TrackTags } from '@/lib/desktop'
import { trackTitle, useLocalLibrary } from '@/store/localLibrary'
import { usePlayer } from '@/store/player'
import { formatTime } from '@/lib/localFiles'
import { carriesPaths, droppedPaths, showDragProxy } from '@/lib/trackDrag'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { commandScope, type MenuEntry } from '@/commands/registry'

/**
 * A flat, ordered list of local tracks: the play queue now, saved playlists
 * later. Rows are reordered by dragging; files and folders dropped on it, from
 * the library tree or the file manager, are inserted where they land.
 */

const COLUMNS = [
  { label: 'Name', width: 'minmax(0, 1fr)' },
  { label: 'Time', width: '48px' },
]
const TEMPLATE = COLUMNS.map((c) => c.width).join(' ')
const ROW_HEIGHT = 30

/** A row being dragged within the list: its index. */
const ROW_TYPE = 'application/x-player-playlist-row'

interface Props {
  tracks: LooseFileEntry[]
  /** Scroll the selected track into view as playback moves through the list. */
  followSelection: boolean
  onPlay: (index: number) => void
  onMove: (from: number, to: number) => void
  /** Paths dropped on the list, to insert before `index`. */
  onDropPaths: (paths: string[], index: number) => void
  onRemove: (index: number) => void
  /** What the list is called in labels: "Remove … from the {name}". */
  name: string
  /** Commands a right-click or a key on a row offers; Enter and Delete come from here. */
  rowCommands: (track: LooseFileEntry, index: number) => MenuEntry[]
  /** Commands for the list as a whole, offered after a row's. */
  listCommands: () => MenuEntry[]
  empty: ReactNode
}

export function Playlist({
  tracks,
  followSelection,
  onPlay,
  onMove,
  onDropPaths,
  onRemove,
  name,
  rowCommands,
  listCommands,
  empty,
}: Props) {
  const tags = useLocalLibrary((s) => s.tags)
  const selectedId = usePlayer((s) => s.selectedId)
  const status = usePlayer((s) => s.status)
  const isLive = status === 'playing' || status === 'buffering'

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => tracks[index]!.path,
    overscan: 12,
  })
  const items = virtualizer.getVirtualItems()

  // Read through a ref: only a moving selection scrolls, not a reorder.
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  useEffect(() => {
    if (!followSelection || !selectedId) return
    const index = tracksRef.current.findIndex((t) => t.url === selectedId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto', behavior: 'smooth' })
  }, [selectedId, followSelection, virtualizer])

  /** Where a drop would land: the gap before this index; null when not dragging over. */
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const indexAt = (clientY: number): number => {
    const el = scrollRef.current!
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop
    return Math.max(0, Math.min(Math.round(y / ROW_HEIGHT), tracks.length))
  }

  const onDragOver = (e: React.DragEvent) => {
    const internal = e.dataTransfer.types.includes(ROW_TYPE)
    if (!internal && !carriesPaths(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy'
    setDropIndex(indexAt(e.clientY))
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const index = indexAt(e.clientY)
    setDropIndex(null)
    const row = e.dataTransfer.getData(ROW_TYPE)
    if (row !== '') onMove(Number(row), index)
    else onDropPaths(droppedPaths(e), index)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="row"
        style={{ gridTemplateColumns: TEMPLATE }}
        className="grid h-9 shrink-0 items-center gap-3 border-b border-line-soft bg-bg-raised px-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint"
      >
        {COLUMNS.map((c, i) => (
          <span key={c.label} className={cn('truncate', i === COLUMNS.length - 1 && 'text-right')}>
            {c.label}
          </span>
        ))}
      </div>

      <div
        ref={scrollRef}
        role="grid"
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null)
        }}
        onDrop={onDrop}
        {...commandScope(listCommands)}
        className={cn(
          'relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin',
          dropIndex !== null && tracks.length === 0 && 'bg-accent/5',
        )}
      >
        {tracks.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-ink-faint">
            {empty}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
              const track = tracks[item.index]!
              return (
                <div
                  key={item.key}
                  {...commandScope(() => rowCommands(track, item.index))}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <TrackRow
                    track={track}
                    index={item.index}
                    tags={tags[track.path]}
                    isSelected={selectedId === track.url}
                    isPlaying={selectedId === track.url && isLive}
                    listName={name}
                    onPlay={onPlay}
                    onRemove={onRemove}
                  />
                </div>
              )
            })}
            {dropIndex !== null && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-accent"
                style={{ top: Math.max(0, dropIndex * ROW_HEIGHT - 1) }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const TrackRow = memo(function TrackRow({
  track,
  index,
  tags,
  isSelected,
  isPlaying,
  listName,
  onPlay,
  onRemove,
}: {
  track: LooseFileEntry
  index: number
  tags?: TrackTags
  isSelected: boolean
  isPlaying: boolean
  listName: string
  onPlay: (index: number) => void
  onRemove: (index: number) => void
}) {
  const title = trackTitle(track, tags)
  return (
    <div
      role="row"
      tabIndex={0}
      draggable
      title={track.missing ? `Not found: ${track.path}` : track.path}
      onDragStart={(e) => {
        e.dataTransfer.setData(ROW_TYPE, String(index))
        e.dataTransfer.effectAllowed = 'move'
        showDragProxy(e)
      }}
      onDoubleClick={() => onPlay(index)}
      data-index={index}
      style={{ gridTemplateColumns: TEMPLATE }}
      className={cn(
        'group grid h-full cursor-default items-center gap-3 border-b border-line-soft px-3 text-[13px] outline-none hover:bg-bg-raised focus-visible:bg-bg-raised',
        isSelected && 'bg-accent/8',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
          onClick={() => onPlay(index)}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
            isSelected
              ? 'border-bg bg-accent text-bg'
              : 'border-line text-ink-dim opacity-0 group-hover:opacity-100 hover:border-accent hover:text-accent',
          )}
        >
          <Icon name={isPlaying ? 'pause' : 'play'} size={12} />
        </button>
        <span
          className={cn(
            'truncate',
            track.missing ? 'text-ink-faint line-through' : isSelected ? 'text-accent' : 'text-ink',
          )}
        >
          {title}
          {tags?.artist && <span className={isSelected ? 'text-accent-dim' : 'text-ink-faint'}> · {tags.artist}</span>}
        </span>
        <button
          type="button"
          aria-label={`Remove ${title} from the ${listName}`}
          title={`Remove from the ${listName} (Delete)`}
          onClick={() => onRemove(index)}
          className="ml-auto shrink-0 rounded p-1 text-ink-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-panel hover:text-bad"
        >
          <Icon name="x" size={13} />
        </button>
      </div>
      <span className="text-right tabular-nums text-ink-dim">{tags?.duration ? formatTime(tags.duration) : ''}</span>
    </div>
  )
})
