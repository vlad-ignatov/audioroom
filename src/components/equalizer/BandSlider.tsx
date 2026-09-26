import * as Slider from '@radix-ui/react-slider'
import { GAIN_MAX, GAIN_MIN, formatFrequency } from '@/audio/eq'
import { cn } from '@/lib/utils'

interface Props {
  hz: number
  value: number
  disabled?: boolean
  onChange: (db: number) => void
  onCommit?: () => void
}

/**
 * The visual part of a ±12 dB fader: track, dB scale, centre detent and the
 * fill that grows from it. Shared by the band sliders and the preamp so the
 * three stay aligned; the Thumb is left to the caller, which styles it.
 *
 * Everything is inset by half the thumb's height. Radix keeps the thumb
 * inside the track, so its centre travels from 7px below the top to 7px above
 * the bottom, and a scale drawn edge to edge would not meet it at ±12.
 */
export function GainTrack({ value, fillClassName }: { value: number; fillClassName: string }) {
  return (
    <Slider.Track className="relative w-2 grow rounded-full bg-black border border-line-soft">
      <span className="db-scale pointer-events-none absolute inset-y-[7px] left-1/2 w-6 -translate-x-1/2" />
      <span className="absolute inset-x-0 inset-y-[7px]">
        <span className="absolute left-0 right-0 top-1/2 h-px bg-line" />
        <span
          className={cn('absolute left-0 right-0', fillClassName)}
          style={
            value >= 0
              ? { bottom: '50%', height: `${(value / GAIN_MAX) * 50}%` }
              : { top: '50%', height: `${(Math.abs(value) / GAIN_MAX) * 50}%` }
          }
        />
      </span>
    </Slider.Track>
  )
}

export function BandSlider({ hz, value, disabled, onChange, onCommit }: Props) {
  const label = `${formatFrequency(hz)} hertz band`
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0 flex-1">
      <span
        className={cn(
          'text-[10px] tabular-nums transition-colors',
          value === 0 ? 'text-ink-faint' : value > 0 ? 'text-accent' : 'text-ink-dim',
        )}
      >
        {value > 0 ? '+' : ''}
        {value.toFixed(1)}
      </span>

      <Slider.Root
        className={cn(
          // Grows to fill the row rather than sitting at a fixed height: the
          // panel is stretched to match its neighbour, and a taller travel makes
          // fine adjustments easier. min-h keeps it usable in a short window,
          // where the drawer scrolls instead.
          'relative flex min-h-24 w-full flex-1 flex-col items-center touch-none select-none',
          disabled && 'opacity-40',
        )}
        orientation="vertical"
        min={GAIN_MIN}
        max={GAIN_MAX}
        step={0.5}
        value={[value]}
        disabled={disabled}
        aria-label={label}
        onValueChange={([v]) => onChange(v ?? 0)}
        onValueCommit={onCommit}
      >
        {/* The fill grows from the centre detent, so cut and boost read differently. */}
        <GainTrack value={value} fillClassName="bg-accent-dim" />
        <Slider.Thumb
          className={cn(
            'block h-3.5 w-6 rounded-[4px] border border-1 border-ink-dim bg-gradient-to-b from-ink-faint to-ink-dim shadow-sm transition-colors shadow',
            'hover:border-ink hover:from-ink-dim hover:to-ink',
            'focus-visible:border-ink focus-visible:from-ink-dim focus-visible:to-ink',
          )}
        />
      </Slider.Root>

      <span className="text-[10px] text-ink-faint">{formatFrequency(hz)}</span>
    </div>
  )
}
