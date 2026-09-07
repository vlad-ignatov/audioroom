import { REVERB_PRESETS } from '@/audio/fx'
import { useFx } from '@/store/fx'
import { useLeveling, TARGETS } from '@/store/leveling'
import { usePlayer } from '@/store/player'
import { Icon } from '@/components/ui/Icon'
import { ParamSlider } from '@/components/ui/ParamSlider'
import { cn } from '@/lib/utils'

function Toggle({
  on,
  label,
  onClick,
  disabled,
}: {
  on: boolean
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors whitespace-nowrap',
        on
          ? 'border-accent/50 bg-accent/15 text-accent'
          : 'border-line bg-panel text-ink-faint hover:text-ink-dim',
        disabled && 'opacity-40',
      )}
    >
      <Icon name="power" size={11} className="flex-shrink-0" />
      {label}
    </button>
  )
}

function describeWidth(w: number): string {
  if (w === 0) return 'mono'
  if (w < 1) return `${Math.round(w * 100)}%`
  return `${Math.round(w * 100)}%`
}

export function SpacePanel() {
  const fx = useFx()
  const leveling = useLeveling()
  const pipeline = usePlayer((s) => s.pipeline)
  const status = usePlayer((s) => s.status)
  const loudness = usePlayer((s) => s.loudnessLufs)
  const levelGainDb = usePlayer((s) => s.levelGainDb)

  // Exactly like the equalizer: these live in the Web Audio graph, so a station
  // the server will not let us process cannot have them.
  const inert = status !== 'idle' && pipeline === 'plain'

  return (
    <section
      className="flex min-w-[390px] flex-[1_1_390px] flex-col gap-3 border-t border-l border-line-soft px-4 py-3"
      aria-label="Space effects"
    >
      {/* ---- reverb ---- */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-nowrap items-center gap-2">
          <Toggle
            on={fx.reverbEnabled}
            label="Reverb"
            disabled={inert}
            onClick={() => fx.setReverbEnabled(!fx.reverbEnabled)}
          />
          <div className="flex flex-nowrap items-center gap-0.5">
            {REVERB_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={inert || !fx.reverbEnabled}
                onClick={() => fx.applyReverbPreset(p.id)}
                className={cn(
                  'shrink-0 rounded px-2 py-0.5 text-[10px] whitespace-nowrap transition-colors',
                  p.id === fx.reverbPresetId
                    ? 'bg-ink/10 text-ink'
                    : 'text-ink-faint hover:text-ink-dim',
                  (inert || !fx.reverbEnabled) && 'opacity-40',
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <ParamSlider
          label="Mix"
          value={fx.mix}
          min={0}
          max={1}
          display={`${Math.round(fx.mix * 100)}%`}
          disabled={inert || !fx.reverbEnabled}
          onChange={fx.setMix}
        />
        <ParamSlider
          label="Decay"
          value={fx.seconds}
          min={0.2}
          max={6}
          step={0.1}
          display={`${fx.seconds.toFixed(1)} s`}
          disabled={inert || !fx.reverbEnabled}
          onChange={fx.setSeconds}
          onCommit={fx.commitSeconds}
        />
        <ParamSlider
          label="Pre-delay"
          value={fx.preDelayMs}
          min={0}
          max={120}
          step={1}
          display={`${Math.round(fx.preDelayMs)} ms`}
          disabled={inert || !fx.reverbEnabled}
          onChange={fx.setPreDelay}
        />
      </div>

      {/* ---- stereo width ---- */}
      <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
        <div className="flex items-center gap-2">
          <Toggle
            on={fx.widthEnabled}
            label="Stereo width"
            disabled={inert}
            onClick={() => fx.setWidthEnabled(!fx.widthEnabled)}
          />
          <span className="ml-auto font-mono text-[10px] text-ink-faint">
            {fx.width === 1 ? 'neutral' : fx.width < 1 ? 'narrow' : 'wide'}
          </span>
        </div>
        <ParamSlider
          label="Width"
          value={fx.width}
          min={0}
          max={2}
          origin={1}
          display={describeWidth(fx.width)}
          disabled={inert || !fx.widthEnabled}
          onChange={fx.setWidth}
        />
      </div>

      {/* ---- auto level ---- */}
      <div className="border-t border-line-soft pt-3">
        <div className="mb-2 flex items-center gap-2">
          <Toggle
            on={leveling.enabled}
            label="Auto level"
            disabled={inert}
            onClick={() => leveling.setEnabled(!leveling.enabled)}
          />
          <div className="flex items-center gap-1">
            {TARGETS.map((t) => (
              <button
                key={t.value}
                type="button"
                title={t.hint}
                disabled={inert || !leveling.enabled}
                onClick={() => leveling.setTarget(t.value)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] transition-colors',
                  leveling.target === t.value
                    ? 'bg-ink/10 text-ink'
                    : 'text-ink-faint hover:text-ink-dim',
                  (inert || !leveling.enabled) && 'opacity-40',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="ml-auto font-mono text-[10px] tabular-nums text-ink-faint">
            {loudness === null
              ? 'measuring…'
              : `${loudness.toFixed(1)} LUFS  ${levelGainDb >= 0 ? '+' : ''}${levelGainDb.toFixed(1)} dB`}
          </span>
        </div>
        <p className="text-[10px] leading-relaxed text-ink-faint">
          Measures each station and evens them out, so switching does not jump in
          volume. Corrections are capped at ±12 dB and remembered per station.
        </p>
      </div>

    </section>
  )
}
