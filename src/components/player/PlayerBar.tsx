import { useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { useLibrary } from '@/store/library'
import { findLocalTrack, useLocalLibrary } from '@/store/localLibrary'
import { usePlayer } from '@/store/player'
import { Icon } from '@/components/ui/Icon'
import { IconButton } from '@/components/ui/Button'
import { Visualizer } from '@/components/visualizer/Visualizer'
import { EqualizerToggleButton } from '@/components/equalizer/EqualizerPanel'
import { SeekBar, TimeReadout } from './SeekBar'
import { cn } from '@/lib/utils'

/**
 * Only the states nothing else in the bar shows. Playing and paused are on the
 * transport button, idle on the name line, and an error is its own message.
 */
const STATUS_TEXT: Partial<Record<string, string>> = {
  connecting: 'Connecting…',
  buffering: 'Buffering…',
}

/**
 * The station's favicon, or a placeholder when it has none or it will not load.
 *
 * The failure is tracked in state keyed to the URL. Hiding the element from
 * the error handler instead — as this once did — leaked across stations: React
 * reuses the same <img> for the next favicon and only swaps `src`, so an
 * imperative `visibility: hidden` outlived the station that caused it.
 */
function StationArt({ src }: { src?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt=""
        className="h-12 w-12 shrink-0 object-fit rounded"
        onError={() => setFailed(src)}
        style={{
            background: `radial-gradient(circle, #FFF 0%, var(--color-bg) 200%)`,
          }}
      />
    )
  }
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gradient-to-b from-ink/20 to-ink/10 text-accent">
      <Icon name="note" size={28} />
    </div>
  )
}

export function PlayerBar({
  eqOpen,
  onToggleEq,
}: {
  eqOpen: boolean
  onToggleEq: () => void
}) {
  const { selectedId, status, message, volume, muted, queue, nowPlaying, seekable, togglePlayback, step, setVolume, toggleMute } =
    usePlayer()
  // The selection, not the engine's station: the bar keeps showing what you
  // are on while it is paused or stopped.
  const libraryStation = useLibrary((s) => s.stations.find((x) => x.id === selectedId))
  const localTrack = useLocalLibrary((s) => (selectedId ? findLocalTrack(selectedId, s) : undefined))
  const station = libraryStation ?? localTrack
  const isLive = status === 'playing' || status === 'buffering' || status === 'connecting'

  return (
    <div className="relative flex h-16 shrink-0 items-center gap-4 border-t border-line-soft bg-bg px-4">
      {/* Keyed by track: a new track starts with a fresh bar, never with a
          half-finished drag from the last one. */}
      {seekable && <SeekBar key={selectedId ?? ''} />}
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="Previous station" size="md" onClick={() => void step(-1)}>
          <Icon name="prev" size={18} />
        </IconButton>
        <button
          type="button"
          aria-label={isLive ? 'Pause' : 'Play'}
          disabled={!station && queue.length === 0}
          // togglePlayback falls back to the head of the queue when nothing has
          // ever been selected, so it covers the empty case too.
          onClick={() => void togglePlayback()}
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-full transition-colors',
            'bg-accent text-bg hover:bg-accent/90 disabled:opacity-30',
          )}
        >
          <Icon name={isLive ? 'pause' : 'play'} size={20} />
        </button>
        <IconButton label="Next station" size="md" onClick={() => void step(1)}>
          <Icon name="next" size={18} />
        </IconButton>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <StationArt src={station?.favicon} />

        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] text-ink font-semibold">
            {station?.name ?? 'Select a station'}
          </div>
          <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-ink-faint">
            {/* {status === 'playing' && (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-good" />
            )} */}
            {STATUS_TEXT[status] && <span>{STATUS_TEXT[status]}</span>}
            {seekable && <TimeReadout />}
            {status === 'error' && message ? (
              <span className="truncate text-bad" title={message}>
                {message}
              </span>
            ) : nowPlaying ? (
              // Not every station broadcasts a track, so this replaces the
              // codec details rather than adding a third line to the bar.
              <span className="flex min-w-0 items-center gap-1.5 text-ink-dim">
                {/* <Icon name="volume" size={10} className="shrink-0 text-accent-dim" /> */}
                <span className="truncate" title={nowPlaying.text}>
                  {nowPlaying.artist ? (
                    <>
                      <span className="text-ink">{nowPlaying.artist}</span>
                      {' — '}
                      <span className="text-ink-dim">{nowPlaying.title}</span>
                    </>
                  ) : (
                    nowPlaying.text
                  )}
                </span>
              </span>
            ) : (
              <>
                {station?.codec && <span className="font-mono">{station.codec}</span>}
                {station?.bitrate ? <span className="tabular-nums">{station.bitrate}k</span> : null}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="hidden h-12 w-40 shrink-0 md:block lg:w-64 relative">
        <Visualizer bars={40} />
        {/* Slices the bars into segments: a 1px line in the bar's background
            colour every 4px, so each bar reads as a stack of LEDs. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `repeating-linear-gradient(
              to top,
              transparent 0 2px,
              var(--color-bg) 2px 2.5px
            )`,
          }}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton label={muted ? 'Unmute' : 'Mute'} size="md" onClick={toggleMute}>
          <Icon name={muted || volume === 0 ? 'mute' : 'volume'} size={16} />
        </IconButton>
        <Slider.Root
          className="relative flex h-5 w-24 touch-none select-none items-center"
          min={0}
          max={1}
          step={0.01}
          value={[muted ? 0 : volume]}
          aria-label="Volume"
          onValueChange={([v]) => setVolume(v ?? 0)}
        >
          <Slider.Track className="relative h-1 w-full grow rounded-full bg-black">
            <Slider.Range className="absolute h-full rounded-full bg-accent-dim" />
          </Slider.Track>
          <Slider.Thumb className="block h-3 w-3 rounded-full bg-ink shadow hover:bg-accent" />
        </Slider.Root>
        <EqualizerToggleButton open={eqOpen} onToggle={onToggleEq} />
      </div>
    </div>
  )
}
