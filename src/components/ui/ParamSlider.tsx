import * as Slider from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

interface Props {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** Rendered readout, e.g. "2.9 s" or "35%". */
  display: string
  disabled?: boolean
  /** Fill grows from this value; use 1 for width, where 1 is neutral. */
  origin?: number
  onChange: (v: number) => void
  onCommit?: () => void
}

export function ParamSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  display,
  disabled,
  origin = min,
  onChange,
  onCommit,
}: Props) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100
  const from = Math.min(pct(origin), pct(value))
  const to = Math.max(pct(origin), pct(value))

  return (
    <div className={cn('flex items-center gap-2.5', disabled && 'opacity-40')}>
      <span className="w-14 shrink-0 text-[11px] text-ink-faint">{label}</span>
      <Slider.Root
        className="relative flex h-4 flex-1 touch-none select-none items-center"
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        aria-label={label}
        onValueChange={([v]) => onChange(v ?? min)}
        onValueCommit={onCommit}
      >
        <Slider.Track className="relative h-1 w-full grow rounded-full bg-black">
          <span
            className="absolute h-full rounded-full bg-accent-dim"
            style={{ left: `${from}%`, width: `${to - from}%` }}
          />
        </Slider.Track>
        <Slider.Thumb className="block h-3 w-3 rounded-full border border-line bg-ink shadow hover:border-accent" />
      </Slider.Root>
      <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-ink-dim">
        {display}
      </span>
    </div>
  )
}
