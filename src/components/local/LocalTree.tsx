import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { desktop, playableUrl, type DirFile, type TrackTags } from '@/lib/desktop'
import { trackTitle, useLocalLibrary, type Listing } from '@/store/localLibrary'
import { usePlayer } from '@/store/player'
import { formatTime } from '@/lib/localFiles'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { tagsLookBroken } from '@/lib/encoding'
import { cmd, commandScope, run } from '@/commands'
import { useUi } from '@/store/ui'
import { TagEditorDialog } from './TagEditorDialog'
import { EncodingFixDialog } from './EncodingFixDialog'
import { FolderTagsDialog } from './FolderTagsDialog'

/** One visible line of the tree, after flattening the open folders. */
type Row =
  | { kind: 'folder'; key: string; path: string; name: string; depth: number; root: boolean; open: boolean; cover?: string }
  | { kind: 'file'; key: string; file: DirFile; depth: number; loose?: boolean }
  | { kind: 'note'; key: string; text: string; depth: number; error?: boolean; path?: string }

const COLUMNS = [
  { label: 'Name', width: 'minmax(260px, 2.6fr)' },
  { label: 'Artist', width: 'minmax(60px, 1.2fr)' },
  { label: 'Album', width: 'minmax(60px, 1.2fr)' },
  { label: 'Time', width: '60px' },
  { label: 'Codec', width: '60px' },
  { label: 'Bitrate', width: '60px' },
]
const TEMPLATE = COLUMNS.map((c) => c.width).join(' ')
/** Sum of the column floors, gaps and padding; see StationTable for why. */
const MIN_WIDTH = 260 + 60 + 60 + 60 + 60 + 60 + 5 * 12 + 24

const HEADER_HEIGHT = 36
const ROW_HEIGHT = 30
const INDENT = 24

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

/**
 * Walk the roots, descending only into open folders. A folder that is open but
 * not read yet contributes a "Loading…" line; the effect below reads it.
 */
function flatten(
  roots: string[],
  looseFiles: DirFile[],
  listings: Record<string, Listing>,
  expanded: Record<string, true>,
): Row[] {
  const rows: Row[] = []
  const walk = (path: string, name: string, depth: number, root: boolean) => {
    const open = expanded[path] === true
    const listing = listings[path]
    // Known once the folder has been read, so closed-but-visited folders keep it.
    const cover = listing?.status === 'ready' && listing.cover ? playableUrl(listing.cover) : undefined
    rows.push({ kind: 'folder', key: path, path, name, depth, root, open, cover })
    if (!open) return
    if (!listing || listing.status === 'loading') {
      rows.push({ kind: 'note', key: `${path}\0note`, text: 'Loading…', depth: depth + 1 })
      return
    }
    if (listing.status === 'error') {
      rows.push({ kind: 'note', key: `${path}\0note`, text: listing.message, depth: depth + 1, error: true, path })
      return
    }
    for (const folder of listing.folders) walk(folder.path, folder.name, depth + 1, false)
    for (const file of listing.files) rows.push({ kind: 'file', key: file.path, file, depth: depth + 1 })
    if (listing.folders.length === 0 && listing.files.length === 0) {
      rows.push({ kind: 'note', key: `${path}\0note`, text: 'No audio files', depth: depth + 1 })
    }
  }
  for (const root of roots) walk(root, baseName(root), 0, true)
  // Files added on their own come after the folders, at the top level.
  for (const file of looseFiles) rows.push({ kind: 'file', key: file.path, file, depth: 0, loose: true })
  return rows
}

export function LocalTree({ onNotify }: { onNotify: (message: string) => void }) {
  const roots = useLocalLibrary((s) => s.roots)
  const looseFiles = useLocalLibrary((s) => s.looseFiles)
  const listings = useLocalLibrary((s) => s.listings)
  const expanded = useLocalLibrary((s) => s.expanded)
  const tags = useLocalLibrary((s) => s.tags)
  const { setExpanded, load, requestTags } = useLocalLibrary.getState()
  const selectedId = usePlayer((s) => s.selectedId)
  const status = usePlayer((s) => s.status)
  const { setQueue } = usePlayer.getState()
  const tagEditor = useUi((s) => s.tagEditor)
  const encodingFix = useUi((s) => s.encodingFix)
  const folderTags = useUi((s) => s.folderTags)
  const { setTagEditor, setEncodingFix, setFolderTags } = useUi.getState()

  /**
   * Folders known to hold mis-encoded tags, in themselves or below: only these
   * offer "Fix encoding…". Known means seen — tags are read for rows on screen —
   * so a folder qualifies once one of its broken tracks has been shown, and
   * every folder above it up to the root does too.
   */
  const needsFix = useMemo(() => {
    const out = new Set<string>()
    const rootSet = new Set(roots)
    for (const [dir, listing] of Object.entries(listings)) {
      if (listing.status !== 'ready' || !listing.files.some((f) => tagsLookBroken(tags[f.path]))) continue
      for (let p = dir; p && !out.has(p); ) {
        out.add(p)
        if (rootSet.has(p)) break
        const up = p.replace(/[\\/][^\\/]*$/, '')
        if (!up || up === p) break
        p = up
      }
    }
    return out
  }, [listings, tags, roots])

  const rows = useMemo(
    () => flatten(roots, looseFiles, listings, expanded),
    [roots, looseFiles, listings, expanded],
  )
  const removeFile = useCallback((file: DirFile) => run('library.removeFile', { path: file.path }), [])
  const trackIds = useMemo(
    () => rows.flatMap((r) => (r.kind === 'file' ? [r.file.url] : [])),
    [rows],
  )

  // Read open folders that have not been read yet: those restored from the
  // last session, and children revealed when a parent finishes loading.
  useEffect(() => {
    for (const row of rows) {
      if (row.kind === 'folder' && row.open && !listings[row.path]) void load(row.path)
    }
  }, [rows, listings, load])

  // Same rule as the station table: keep the queue in step with what is shown,
  // but only while playback belongs to this list.
  useEffect(() => {
    const selected = usePlayer.getState().selectedId
    if (selected && trackIds.includes(selected)) setQueue(trackIds)
  }, [trackIds, setQueue])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]!.key,
    overscan: 12,
    scrollMargin: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  })
  const items = virtualizer.getVirtualItems()

  /**
   * Keep the selected track in view, as the station table does: next/previous
   * and auto-advance move the selection without touching the rows.
   *
   * Once per selection. Its row may appear only after the tree renders — on
   * switching to this tab the open folders are still being read — so keep
   * looking as rows arrive, but stop once scrolled: opening another folder
   * later must not yank the view back.
   */
  const scrolledTo = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedId || scrolledTo.current === selectedId) return
    const index = rows.findIndex((r) => r.kind === 'file' && r.file.url === selectedId)
    if (index < 0) return
    scrolledTo.current = selectedId
    virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' })
  }, [selectedId, rows, virtualizer])

  // Tags only for what is on screen; a library of thousands is never read whole.
  const first = items[0]?.index ?? 0
  const last = items[items.length - 1]?.index ?? -1
  useEffect(() => {
    const paths: string[] = []
    for (let i = first; i <= last; i++) {
      const row = rows[i]
      if (row?.kind === 'file') paths.push(row.file.path)
    }
    if (paths.length > 0) requestTags(paths)
  }, [first, last, rows, requestTags])

  const editFile = useCallback((file: DirFile) => run('track.editInfo', { file }), [])
  const playFile = (file: DirFile) => run('track.play', { file, queue: trackIds })

  /** What a right-click (or a key) on a row offers. */
  const rowCommands = (row: Row) => () => {
    if (row.kind === 'folder') {
      const path = row.path
      return [
        cmd('folder.editInfo', { path }),
        needsFix.has(path) && cmd('folder.fixEncoding', { path }),
        '-' as const,
        cmd('file.reveal', { path }),
        row.root && cmd('library.removeFolder', { path }),
      ]
    }
    if (row.kind === 'file') {
      const { file } = row
      return [
        cmd('track.play', { file, queue: trackIds }),
        '-' as const,
        cmd('track.editInfo', { file }),
        cmd('file.reveal', { path: file.path }),
        row.loose && cmd('library.removeFile', { path: file.path }),
      ]
    }
    return []
  }

  if (!desktop) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-dim">
        The local library needs the desktop app.
      </div>
    )
  }

  if (roots.length === 0 && looseFiles.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-ink-dim">Add a folder to browse the music in it, or add single files.</p>
        <div className="flex gap-2">
          <Button variant="accent" onClick={() => run('library.addFolder')}>
            <Icon name="folderPlus" size={14} />
            Add folder
          </Button>
          <Button variant="solid" onClick={() => run('library.addFiles')}>
            <Icon name="filePlus" size={14} />
            Add files
          </Button>
        </div>
      </div>
    )
  }

  const isLive = status === 'playing' || status === 'buffering'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        role="treegrid"
        className="min-h-0 flex-1 overflow-auto scrollbar-thin"
        {...commandScope(() => [cmd('library.addFolder'), cmd('library.addFiles'), cmd('library.refresh')])}
      >
        <div style={{ minWidth: MIN_WIDTH }}>
          <div
            role="row"
            style={{ gridTemplateColumns: TEMPLATE }}
            className="sticky top-0 z-20 grid h-9 items-center gap-3 border-b border-line-soft bg-bg-raised px-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint"
          >
            {COLUMNS.map((c) => (
              <span key={c.label} className="truncate">
                {c.label}
              </span>
            ))}
          </div>

          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
              const row = rows[item.index]!
              return (
                <div
                  key={row.key}
                  {...commandScope(rowCommands(row))}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start - HEADER_HEIGHT}px)`,
                  }}
                >
                  {row.kind === 'folder' ? (
                    <FolderRow
                      row={row}
                      onToggle={() => setExpanded(row.path, !row.open)}
                      onRemove={() => run('library.removeFolder', { path: row.path })}
                      onFixEncoding={needsFix.has(row.path) ? () => run('folder.fixEncoding', { path: row.path }) : undefined}
                      onEditTags={() => run('folder.editInfo', { path: row.path })}
                    />
                  ) : row.kind === 'file' ? (
                    <FileRow
                      file={row.file}
                      depth={row.depth}
                      tags={tags[row.file.path]}
                      isSelected={selectedId === row.file.url}
                      isPlaying={selectedId === row.file.url && isLive}
                      onPlay={playFile}
                      onEdit={editFile}
                      onRemove={row.loose ? removeFile : undefined}
                    />
                  ) : (
                    <div
                      className={cn('flex h-full items-center px-3 text-[12px] italic', row.error ? 'text-bad' : 'text-ink-faint')}
                      style={{ paddingLeft: 12 + row.depth * INDENT + 20 }}
                    >
                      {row.text}
                      {row.error && row.path && (
                        <button
                          type="button"
                          onClick={() => void load(row.path!)}
                          className="ml-2 rounded px-1.5 not-italic text-ink-faint hover:bg-panel hover:text-ink"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>


      <TagEditorDialog file={tagEditor} onClose={() => setTagEditor(null)} onNotify={onNotify} />
      <EncodingFixDialog folder={encodingFix} onClose={() => setEncodingFix(null)} />
      <FolderTagsDialog folder={folderTags} onClose={() => setFolderTags(null)} />
    </div>
  )
}

const rowBase =
  'group grid h-full items-center gap-3 border-b border-line-soft px-3 text-[13px] outline-none hover:bg-bg-raised focus-visible:bg-bg-raised'

const FolderRow = memo(function FolderRow({
  row,
  onToggle,
  onRemove,
  onFixEncoding,
  onEditTags,
}: {
  row: Extract<Row, { kind: 'folder' }>
  onToggle: () => void
  onRemove: () => void
  /** Only for folders known to hold mis-encoded tags. */
  onFixEncoding?: () => void
  onEditTags: () => void
}) {
  return (
    <div
      role="row"
      aria-expanded={row.open}
      aria-level={row.depth + 1}
      tabIndex={0}
      title={row.root ? row.path : undefined}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onToggle()
        }
      }}
      style={{ gridTemplateColumns: TEMPLATE }}
      className={cn(rowBase, 'cursor-default select-none')}
    >
      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: row.depth * INDENT }}>
        <Icon
          name="chevronRight"
          size={14}
          className={cn('shrink-0 text-ink-faint transition-transform', row.open && 'rotate-90')}
        />
        {row.cover ? (
          <img
            src={row.cover}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-5 w-5 shrink-0 rounded-sm object-cover"
          />
        ) : (
          <Icon name="folder" size={20} className={cn('shrink-0 w-5', row.root ? 'text-accent' : 'text-accent opacity-80')} />
        )}
        <span className={cn('truncate', row.root ? 'font-bold text-ink' : 'font-medium text-ink')}>{row.name}</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            title="Set the artist or album on every file in this folder"
            onClick={(e) => {
              e.stopPropagation()
              onEditTags()
            }}
            className="rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:bg-panel hover:text-ink"
          >
            Edit info…
          </button>
          {onFixEncoding && (
            <button
              type="button"
              title="Find and fix tags stored in the wrong encoding, in this folder and below"
              onClick={(e) => {
                e.stopPropagation()
                onFixEncoding()
              }}
              className="rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:bg-panel hover:text-ink"
            >
              Fix encoding…
            </button>
          )}
          {row.root && (
            <button
              type="button"
              aria-label={`Remove ${row.name} from the library`}
              title="Remove from the library (the files stay on disk)"
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="rounded p-1 text-ink-faint hover:bg-panel hover:text-bad"
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})

const FileRow = memo(function FileRow({
  file,
  depth,
  tags,
  isSelected,
  isPlaying,
  onPlay,
  onEdit,
  onRemove,
}: {
  file: DirFile
  depth: number
  tags?: TrackTags
  isSelected: boolean
  isPlaying: boolean
  onPlay: (file: DirFile) => void
  onEdit: (file: DirFile) => void
  /** Only for files added on their own; one inside a folder goes with the folder. */
  onRemove?: (file: DirFile) => void
}) {
  const title = trackTitle(file, tags)
  const broken = tagsLookBroken(tags)
  return (
    <div
      role="row"
      aria-level={depth + 1}
      tabIndex={0}
      title={file.name}
      onDoubleClick={() => onPlay(file)}
      style={{ gridTemplateColumns: TEMPLATE }}
      className={cn(rowBase, isSelected && 'bg-accent/8')}
    >
      <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * INDENT + INDENT }}>
        <button
          type="button"
          aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
          onClick={() => onPlay(file)}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors -ms-2',
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
            isSelected ? 'text-accent' : tags && !tags.title ? 'text-ink-dim' : 'text-ink',
            tags && !tags.title && 'italic',
          )}
          title={tags && !tags.title ? 'No title tag — showing the file name' : undefined}
        >
          {title}
        </span>
        <button
          type="button"
          aria-label={`Edit info of ${title}`}
          title={broken ? 'Title or artist look mis-encoded — edit (F2)' : 'Edit info (F2)'}
          onClick={() => onEdit(file)}
          className={cn(
            'ml-auto shrink-0 rounded p-1 hover:bg-panel',
            broken
              ? 'text-warn hover:text-ink'
              : 'text-ink-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-ink',
          )}
        >
          <Icon name={broken ? 'warning' : 'edit'} size={13} />
        </button>
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove ${title} from the library`}
            title="Remove from the library (the file stays on disk)"
            onClick={() => onRemove(file)}
            className="shrink-0 rounded p-1 text-ink-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-panel hover:text-bad"
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
      <span className="truncate text-ink-dim">{tags?.artist ?? ''}</span>
      <span className="truncate text-ink-dim">{tags?.album ?? ''}</span>
      <span className="tabular-nums text-ink-dim">{tags?.duration ? formatTime(tags.duration) : ''}</span>
      <span className="font-mono text-[11px] text-ink-dim">{tags?.codec ?? ''}</span>
      <span className="tabular-nums text-ink-dim">{tags?.bitrate ? `${tags.bitrate}k` : ''}</span>
    </div>
  )
})
