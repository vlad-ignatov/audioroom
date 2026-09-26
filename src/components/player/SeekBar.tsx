import { useEffect, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { engine, type Timing } from '@/audio/engine'
import { usePlayer } from '@/store/player'
import { formatTime } from '@/lib/localFiles'
import { cn } from '@/lib/utils'

/**
 * The position within the current local file, straight from the engine.
 *
 * Kept out of the player store on purpose: the element reports its time
 * several times a second, and the store is read by the station table, which
 * has no use for it and should not re-render at that rate.
 */
function useTiming(): Timing {
  const [timing, setTiming] = useState<Timing>({ position: 0, duration: null })
  useEffect(() => engine.subscribeTime(setTiming), [])
  return timing
}

/**
 * A thin scrubber along the top edge of the player bar.
 *
 * Only ever rendered for a local file. While the thumb is being dragged the
 * bar shows the drag position rather than the playhead, so it does not fight
 * the listener's hand until they let go.
 */
export function SeekBar() {
  const seek = usePlayer((s) => s.seek)
  const { position, duration } = useTiming()
  const [dragging, setDragging] = useState<number | null>(null)

  const max = duration ?? 0
  const shown = dragging ?? position

  return (
    <Slider.Root
      className={cn(
        'group/seek absolute inset-x-0 top-0 flex h-3 -translate-y-1/2 cursor-pointer touch-none select-none items-center',
        max === 0 && 'pointer-events-none',
      )}
      min={0}
      max={max || 1}
      step={1}
      value={[Math.min(shown, max || 1)]}
      aria-label="Position"
      aria-valuetext={`${formatTime(shown)} of ${formatTime(max)}`}
      onValueChange={([v]) => setDragging(v ?? 0)}
      onValueCommit={([v]) => {
        setDragging(null)
        seek(v ?? 0)
      }}
    >
      <Slider.Track className="relative h-0.5 w-full grow bg-line transition-[height] group-hover/seek:h-1">
        <Slider.Range className="absolute h-full bg-accent transition-all duration-100" />
      </Slider.Track>
      <Slider.Thumb className="block h-3 w-3 rounded-full bg-accent opacity-0 shadow outline-none transition-opacity group-hover/seek:opacity-100 focus-visible:opacity-100" />
    </Slider.Root>
  )
}

/** `1:23 / 4:05`, for the details line of the player bar. */
export function TimeReadout() {
  const { position, duration } = useTiming()
  return (
    <span className="tabular-nums">
      {formatTime(position)}
      {duration !== null && ` / ${formatTime(duration)}`}
    </span>
  )
}
