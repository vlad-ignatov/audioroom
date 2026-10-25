import { useEffect, useMemo } from 'react'
import { desktop } from '@/lib/desktop'
import { useLocalLibrary } from '@/store/localLibrary'
import { usePlayQueue, QUEUE_LIMIT } from '@/store/playQueue'
import { usePlayer } from '@/store/player'
import { formatTime } from '@/lib/localFiles'
import { Playlist } from './Playlist'
import { cmd, run } from '@/commands'
import { cn } from '@/lib/utils'

export function PlayQueue({ onNotify }: { onNotify: (message: string) => void }) {
  const tracks = usePlayQueue((s) => s.tracks)
  const { add, move } = usePlayQueue.getState()
  const tags = useLocalLibrary((s) => s.tags)
  const owns = usePlayer((s) => s.queueSource === 'queue')

  // Every queued track's tags, not just those on screen: the total time needs
  // them all, and the queue is capped, so this is bounded.
  useEffect(() => {
    const paths = tracks.filter((t) => !t.missing).map((t) => t.path)
    if (paths.length > 0) useLocalLibrary.getState().requestTags(paths)
  }, [tracks])

  const total = useMemo(() => {
    let seconds = 0
    let unknown = 0
    for (const t of tracks) {
      const d = tags[t.path]?.duration
      if (d) seconds += d
      else unknown++
    }
    return { seconds, unknown }
  }, [tracks, tags])

  const ids = () => tracks.map((t) => t.url)
  const play = (index: number) => {
    const file = tracks[index]
    if (file) run('track.play', { file, source: 'queue', queue: ids() })
  }

  const fileManager = desktop?.platform === 'darwin' ? 'Finder' : 'your file manager'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Playlist
        tracks={tracks}
        name="queue"
        followSelection={owns}
        onPlay={play}
        onMove={move}
        onRemove={(index) => {
          const track = tracks[index]
          if (track) run('queue.remove', { path: track.path })
        }}
        rowCommands={(file) => [
          cmd('track.play', { file, source: 'queue', queue: ids() }),
          '-',
          cmd('queue.moveToTop', { path: file.path }),
          cmd('queue.moveToBottom', { path: file.path }),
          cmd('queue.remove', { path: file.path }),
          '-',
          cmd('track.editInfo', { file }),
          cmd('file.reveal', { path: file.path }),
        ]}
        listCommands={() => [cmd('queue.shuffle'), cmd('queue.clear')]}
        onDropPaths={(paths, index) => void add(paths, index).then((message) => message && onNotify(message))}
        empty={
          <span>
            Drag songs or folders here,
            <br />
            from the library or from {fileManager}.
          </span>
        }
      />
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-line-soft bg-bg-raised px-3 text-[11px] text-ink-faint">
        <span className="truncate tabular-nums">
          {tracks.length === 0
            ? 'Queue empty'
            : `${tracks.length} track${tracks.length === 1 ? '' : 's'} · ${formatTime(total.seconds)}${total.unknown > 0 ? '+' : ''}`}
          {tracks.length >= QUEUE_LIMIT && ' · full'}
        </span>
        {tracks.length > 1 && (
          <button
            type="button"
            onClick={() => run('queue.shuffle')}
            title="Put the queue in random order (the playing track stays first)"
            className="ml-auto shrink-0 rounded px-1.5 py-0.5 hover:bg-panel hover:text-ink"
          >
            Shuffle
          </button>
        )}
        {tracks.length > 0 && (
          <button
            type="button"
            onClick={() => run('queue.clear')}
            title="Remove every track from the queue (the files stay on disk)"
            className={cn('shrink-0 rounded px-1.5 py-0.5 hover:bg-panel hover:text-ink', tracks.length < 2 && 'ml-auto')}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
