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
        <Slider.Track className="relative w-1.5 grow rounded-full bg-bg">
          {/* The fill grows from the centre detent, so cut and boost read differently. */}
          <span className="absolute left-0 right-0 top-1/2 h-px bg-line" />
          <span
            className="absolute left-0 right-0 rounded-full bg-accent-dim"
            style={
              value >= 0
                ? { bottom: '50%', height: `${(value / GAIN_MAX) * 50}%` }
                : { top: '50%', height: `${(Math.abs(value) / GAIN_MAX) * 50}%` }
            }
          />
        </Slider.Track>
        <Slider.Thumb
          className={cn(
            'block h-3.5 w-6 rounded-[3px] border border-6 border-bg/70 bg-accent-dim shadow-sm transition-colors',
            'hover:border-accent focus-visible:border-accent',
          )}
        />
      </Slider.Root>

      <span className="text-[10px] text-ink-faint">{formatFrequency(hz)}</span>
    </div>
  )
}
