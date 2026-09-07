import * as Slider from '@radix-ui/react-slider'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { Icon } from '@/components/ui/Icon'
import { IconButton } from '@/components/ui/Button'
import { Visualizer } from '@/components/visualizer/Visualizer'
import { CapabilityBadge } from '@/components/library/CapabilityBadge'
import { EqualizerToggleButton } from '@/components/equalizer/EqualizerPanel'
import { cn } from '@/lib/utils'

const STATUS_TEXT: Record<string, string> = {
  idle: 'Nothing playing',
  connecting: 'Connecting…',
  buffering: 'Buffering…',
  playing: 'On air',
  paused: 'Paused',
  error: 'Error',
}

export function PlayerBar({
  eqOpen,
  onToggleEq,
}: {
  eqOpen: boolean
  onToggleEq: () => void
}) {
  const { selectedId, status, capability, message, volume, muted, queue, nowPlaying, togglePlayback, step, setVolume, toggleMute } =
    usePlayer()
  // The selection, not the engine's station: the bar keeps showing what you
  // are on while it is paused or stopped.
  const station = useLibrary((s) => s.stations.find((x) => x.id === selectedId))
  const active = status !== 'idle'
  const isLive = status === 'playing' || status === 'buffering' || status === 'connecting'

  return (
    <div className="flex h-16 shrink-0 items-center gap-4 border-t border-line bg-panel px-4">
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="Previous station" size="md" onClick={() => void step(-1)}>
          <Icon name="prev" size={16} />
        </IconButton>
        <button
          type="button"
          aria-label={isLive ? 'Pause' : 'Play'}
          disabled={!station && queue.length === 0}
          // togglePlayback falls back to the head of the queue when nothing has
          // ever been selected, so it covers the empty case too.
          onClick={() => void togglePlayback()}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
            'bg-accent text-bg hover:bg-accent/90 disabled:opacity-30',
          )}
        >
          <Icon name={isLive ? 'pause' : 'play'} size={20} />
        </button>
        <IconButton label="Next station" size="md" onClick={() => void step(1)}>
          <Icon name="next" size={16} />
        </IconButton>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        {station?.favicon ? (
          <img
            src={station.favicon}
            alt=""
            className="h-10 w-10 shrink-0 rounded border border-line object-cover"
            onError={(e) => {
              e.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-line bg-bg text-ink-faint">
            <Icon name="globe" size={16} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink">
            {station?.name ?? 'Select a station'}
          </div>
          <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-ink-faint">
            <span
              className={cn(
                'flex items-center gap-1',
                status === 'error' && 'text-bad',
                status === 'playing' && 'text-good',
              )}
            >
              {status === 'playing' && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" />
              )}
              {STATUS_TEXT[status] ?? status}
            </span>
            {active && station && (
              <CapabilityBadge capability={capability} reason={message ?? station.capabilityReason} />
            )}
            {nowPlaying ? (
              // Not every station broadcasts a track, so this replaces the
              // codec details rather than adding a third line to the bar.
              <span className="flex min-w-0 items-center gap-1.5 text-ink-dim">
                <Icon name="volume" size={10} className="shrink-0 text-accent-dim" />
                <span className="truncate" title={nowPlaying.text}>
                  {nowPlaying.artist ? (
                    <>
                      <span className="text-ink">{nowPlaying.artist}</span>
                      {' — '}
                      {nowPlaying.title}
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

      <div className="hidden h-9 w-40 shrink-0 md:block lg:w-64">
        <Visualizer bars={40} />
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
          <Slider.Track className="relative h-1 w-full grow rounded-full bg-bg">
            <Slider.Range className="absolute h-full rounded-full bg-ink-dim" />
          </Slider.Track>
          <Slider.Thumb className="block h-3 w-3 rounded-full bg-ink shadow hover:bg-accent" />
        </Slider.Root>
        <EqualizerToggleButton open={eqOpen} onToggle={onToggleEq} />
      </div>
    </div>
  )
}
