import { useEffect, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { EQ_FREQUENCIES } from '@/audio/eq'
import { engine } from '@/audio/engine'
import type { LimiterBand } from '@/audio/limiter'
import { useEq } from '@/store/eq'
import { usePlayer } from '@/store/player'
import { Button, IconButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { BandSlider, GainTrack } from './BandSlider'
import { cn } from '@/lib/utils'

/** Reductions smaller than this are not worth pointing out. */
const LIMITING_SHOWN_DB = -0.5
/** How long a reading stays up, so a single kick drum can be read. */
const LIMITING_HOLD_MS = 1200

/**
 * The band the limiter is working hardest on, or null when it is idle.
 *
 * Polled rather than pushed: the compressor only exposes its reduction as a
 * property. Each reading is held for a moment, since limiting on a beat comes
 * and goes faster than anyone can read it.
 */
function useLimiting(): { band: LimiterBand; db: number } | null {
  const [shown, setShown] = useState<{ band: LimiterBand; db: number } | null>(null)
  useEffect(() => {
    let held: { band: LimiterBand; db: number; at: number } | null = null
    const id = window.setInterval(() => {
      const now = performance.now()
      let worst: { band: LimiterBand; db: number } | null = null
      for (const r of engine.getLimiterReduction()) if (!worst || r.db < worst.db) worst = r
      if (worst && worst.db <= LIMITING_SHOWN_DB && (!held || worst.db <= held.db || now - held.at > LIMITING_HOLD_MS)) {
        held = { ...worst, at: now }
      } else if (held && now - held.at > LIMITING_HOLD_MS) {
        held = null
      }
      const next = held ? { band: held.band, db: Math.round(held.db * 10) / 10 } : null
      setShown((prev) => (prev?.band === next?.band && prev?.db === next?.db ? prev : next))
    }, 100)
    return () => clearInterval(id)
  }, [])
  return shown
}

export function EqualizerPanel() {
  const eq = useEq()
  const pipeline = usePlayer((s) => s.pipeline)
  const status = usePlayer((s) => s.status)
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const limiting = useLimiting()

  // The filter bank only exists on the Web Audio path. On a station the server
  // will not let us process, the controls stay visible but inert — hiding them
  // would make the app look broken rather than the station look restricted.
  const inert = status !== 'idle' && pipeline === 'plain'
  const presets = eq.allPresets()
  const activeName = presets.find((p) => p.id === eq.activePresetId)?.name ?? 'Custom'

  return (
    <section
      className="flex min-w-0 flex-[3_1_640px] flex-col gap-3 border-t border-line-soft px-4 py-3"
      aria-label="Equalizer"
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => eq.setEnabled(!eq.enabled)}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors text-nowrap',
            eq.enabled
              ? 'border-accent/50 bg-accent/15 text-accent'
              : 'border-line bg-panel text-ink-faint',
          )}
          aria-pressed={eq.enabled}
        >
          <Icon name="power" size={13} className='flex-shrink-0' />
          {eq.enabled ? 'EQ on' : 'EQ off'}
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="solid" size="sm" className="min-w-32 justify-between">
              {activeName}
              <Icon name="chevronDown" size={12} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={6}
              className="z-50 max-h-80 min-w-44 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-xl scrollbar-thin"
            >
              {presets.map((p) => (
                <DropdownMenu.Item
                  key={p.id}
                  onSelect={() => eq.applyPreset(p.id)}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-[13px] text-ink-dim outline-none data-[highlighted]:bg-panel-hi data-[highlighted]:text-ink"
                >
                  <span className="flex items-center gap-2">
                    {p.id === eq.activePresetId && <Icon name="check" size={12} />}
                    <span className={p.id === eq.activePresetId ? 'text-accent' : undefined}>
                      {p.name}
                    </span>
                  </span>
                  {!p.builtin && (
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Delete ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        eq.deletePreset(p.id)
                      }}
                      className="text-ink-faint hover:text-bad"
                    >
                      <Icon name="trash" size={12} />
                    </span>
                  )}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {naming ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              const name = draftName.trim()
              if (!name) return
              const existing = eq.findPresetByName(name)
              if (existing?.builtin) {
                setNameError(`“${existing.name}” is a built-in preset`)
                return
              }
              // Re-saving the active preset under its own name loses nothing,
              // so only ask when another preset would be replaced.
              if (
                existing &&
                existing.id !== eq.activePresetId &&
                !confirm(`A preset named “${existing.name}” already exists. Replace it?`)
              ) {
                return
              }
              eq.savePreset(name)
              setDraftName('')
              setNaming(false)
            }}
          >
            <input
              autoFocus
              value={draftName}
              onChange={(e) => {
                setDraftName(e.target.value)
                setNameError(null)
              }}
              onBlur={() => {
                setNaming(false)
                setNameError(null)
              }}
              placeholder="Preset name"
              aria-invalid={nameError !== null}
              className={cn(
                'h-7 w-36 rounded-md border bg-bg px-2 text-xs text-ink placeholder:text-ink-faint me-1',
                nameError ? 'border-bad' : 'border-line',
              )}
            />
            <Button type="submit" variant="accent" size="sm" onMouseDown={(e) => e.preventDefault()}>
              Save
            </Button>
            {nameError && <span className="text-xs text-bad">{nameError}</span>}
          </form>
        ) : (
          <Button size="sm" onClick={() => setNaming(true)}>
            Save as…
          </Button>
        )}

        <Button size="sm" onClick={eq.reset}>
          Reset
        </Button>

        {limiting && !inert && (
          <span
            className="ml-auto font-mono text-[11px] tabular-nums text-warn"
            title="A boost is pushing this band past full scale, so the limiter is holding it down. Lower the preamp to give it room."
          >
            Limiting {limiting.band} {limiting.db.toFixed(1)} dB
          </span>
        )}

        {inert && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-warn">
            <Icon name="warning" size={13} />
            Not available for this station
          </span>
        )}
      </header>

      {/* flex-1 so the slider row absorbs whatever height the panel has spare —
          it is stretched to match its neighbour, and that space was unused. */}
      <div className="flex min-h-0 flex-1 items-stretch gap-4">
        <div className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-line-soft pr-4">
          <span className="text-[10px] font-mono tabular-nums text-ink-dim">
            {eq.preamp > 0 ? '+' : ''}
            {eq.preamp.toFixed(1)}
          </span>
          <Slider.Root
            className={cn(
              // Must match BandSlider's sizing exactly, or the centre detents
              // stop lining up across the panel.
              'relative flex min-h-24 w-full flex-1 flex-col items-center touch-none select-none',
              inert && 'opacity-40',
            )}
            orientation="vertical"
            min={-12}
            max={12}
            step={0.5}
            value={[eq.preamp]}
            disabled={inert}
            aria-label="Preamp"
            onValueChange={([v]) => eq.setPreamp(v ?? 0)}
          >
            <GainTrack value={eq.preamp} fillClassName="bg-ink-faint" />
            <Slider.Thumb className="block h-3.5 w-6 rounded-[4px] border border-1 border-ink-dim bg-gradient-to-b from-ink-faint to-ink-dim shadow-sm transition-colors hover:border-ink hover:from-ink-dim hover:to-ink focus-visible:border-ink focus-visible:from-ink-dim focus-visible:to-ink" />
          </Slider.Root>
          <span className="text-[10px] font-mono text-ink-faint">Pre</span>
        </div>

        <div className="flex flex-1 items-stretch gap-1">
          {EQ_FREQUENCIES.map((hz, i) => (
            <BandSlider
              key={hz}
              hz={hz}
              value={eq.gains[i] ?? 0}
              disabled={inert}
              onChange={(db) => eq.setBand(i, db)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

export function EqualizerToggleButton({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  return (
    <IconButton
      label={open ? 'Hide equalizer' : 'Show equalizer'}
      size="md"
      onClick={onToggle}
      className={open ? 'text-accent' : undefined}
    >
      <Icon name="sliders" size={17} />
    </IconButton>
  )
}
