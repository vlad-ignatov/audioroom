import { useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { EQ_FREQUENCIES } from '@/audio/eq'
import { useEq } from '@/store/eq'
import { usePlayer } from '@/store/player'
import { Button, IconButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { BandSlider } from './BandSlider'
import { cn } from '@/lib/utils'

export function EqualizerPanel() {
  const eq = useEq()
  const pipeline = usePlayer((s) => s.pipeline)
  const status = usePlayer((s) => s.status)
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')

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
            'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
            eq.enabled
              ? 'border-accent/50 bg-accent/15 text-accent'
              : 'border-line bg-panel text-ink-faint',
          )}
          aria-pressed={eq.enabled}
        >
          <Icon name="power" size={13} />
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
              eq.savePreset(draftName)
              setDraftName('')
              setNaming(false)
            }}
          >
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => setNaming(false)}
              placeholder="Preset name"
              className="h-7 w-36 rounded-md border border-line bg-bg px-2 text-xs text-ink placeholder:text-ink-faint"
            />
            <Button type="submit" variant="accent" size="sm" onMouseDown={(e) => e.preventDefault()}>
              Save
            </Button>
          </form>
        ) : (
          <Button size="sm" onClick={() => setNaming(true)}>
            Save preset
          </Button>
        )}

        <Button size="sm" onClick={eq.reset}>
          Reset
        </Button>

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
            <Slider.Track className="relative w-1.5 grow rounded-full bg-bg">
              <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
              <span
                className="absolute inset-x-0 rounded-full bg-ink-faint"
                style={
                  eq.preamp >= 0
                    ? { bottom: '50%', height: `${(eq.preamp / 12) * 50}%` }
                    : { top: '50%', height: `${(Math.abs(eq.preamp) / 12) * 50}%` }
                }
              />
            </Slider.Track>
            <Slider.Thumb className="block h-3.5 w-6 rounded-[3px] border border-6 border-line bg-ink-faint hover:border-accent" />
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
