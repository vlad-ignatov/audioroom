import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { Station } from '@/types/station'
import { usePlayer } from '@/store/player'
import { useEq } from '@/store/eq'
import { FilterSidebar } from '@/components/library/FilterSidebar'
import { StationTable } from '@/components/library/StationTable'
import { Toolbar } from '@/components/library/Toolbar'
import { StationDialog } from '@/components/library/StationDialog'
import { DirectoryDialog } from '@/components/search/DirectoryDialog'
import { PlayerBar } from '@/components/player/PlayerBar'
import { EqualizerPanel } from '@/components/equalizer/EqualizerPanel'
import { SpacePanel } from '@/components/effects/SpacePanel'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useDesktopIntegration } from '@/hooks/useDesktopIntegration'

/**
 * Controls that already act on a key themselves.
 *
 * A focused <button> is activated by space, a slider thumb by the arrows, a
 * menu by both. Running the global shortcut as well fires the action twice —
 * pressing space on a focused row button paused and immediately resumed,
 * restarting the stream. `closest` rather than the target itself, because focus
 * often sits on a child of the widget that owns the key.
 */
const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

const SPACE_ACTIVATES = [
  'button',
  'summary',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
].join(', ')

const ARROWS_NAVIGATE = [
  '[role="slider"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="listbox"]',
  '[role="combobox"]',
  '[role="tablist"]',
  '[role="radiogroup"]',
  'a[href]',
].join(', ')

/**
 * Surfaces that take over the keyboard while they are open.
 *
 * A dialog or an open menu owns every key until it closes, so no global
 * shortcut should fire behind one. Testing the focused element is not enough:
 * an open dropdown can leave focus on <body>, and a freshly opened dialog
 * leaves it on the dialog container — in both cases space fell through and
 * paused playback. These surfaces unmount when closed, so their presence in the
 * document is the dependable signal.
 */
const MODAL_SURFACE = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

function modalIsOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector(MODAL_SURFACE) !== null
}

function focusedControlHandles(target: EventTarget | null, key: string): boolean {
  const el = target instanceof Element ? target : null
  if (!el) return false
  if (el.closest(TEXT_ENTRY)) return true
  if (key === ' ') return el.closest(SPACE_ACTIVATES) !== null
  if (key.startsWith('Arrow')) return el.closest(ARROWS_NAVIGATE) !== null
  return false
}

function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const notify = useCallback((text: string) => {
    setMessage(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), 3200)
  }, [])
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  return { message, notify }
}

export default function App() {
  const eqOpen = useEq((s) => s.panelOpen)
  const setEqOpen = useEq((s) => s.setPanelOpen)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [editing, setEditing] = useState<Station | null>(null)
  const [stationDialogOpen, setStationDialogOpen] = useState(false)
  const { message, notify } = useToast()

  const openEditor = useCallback((s: Station | null) => {
    setEditing(s)
    setStationDialogOpen(true)
  }, [])

  // Native menu items and hardware media keys.
  const openDirectory = useCallback(() => setDirectoryOpen(true), [])
  const addStation = useCallback(() => openEditor(null), [openEditor])
  useDesktopIntegration({ onOpenDirectory: openDirectory, onAddStation: addStation })

  // Global shortcuts, suppressed while a focused control owns the key.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // A dialog or open menu owns the keyboard until it closes.
      if (modalIsOpen()) return
      // Let the focused control have the key if it acts on it itself.
      if (focusedControlHandles(e.target, e.key)) return

      const player = usePlayer.getState()
      switch (e.key) {
        case ' ': {
          e.preventDefault()
          // Acts on the selection, not on what the engine happens to hold, so
          // it still resumes after a pause or a stop.
          void player.togglePlayback()
          break
        }
        case 'ArrowRight':
          e.preventDefault()
          void player.step(1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          void player.step(-1)
          break
        case 'ArrowUp':
          e.preventDefault()
          player.setVolume(player.volume + 0.05)
          break
        case 'ArrowDown':
          e.preventDefault()
          player.setVolume(player.volume - 0.05)
          break
        case 'm':
          player.toggleMute()
          break
        case 'e':
          useEq.getState().setPanelOpen(!useEq.getState().panelOpen)
          break
        case 'b':
          setDirectoryOpen(true)
          break
        case '/': {
          e.preventDefault()
          document.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
          break
        }
        case '0':
          useEq.getState().reset()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className="flex h-full flex-col bg-bg">
        <header className="app-titlebar flex h-9 shrink-0 items-center gap-2 border-b border-line-soft px-4">
          {/* <span className="flex h-6 w-6 items-center justify-center rounded bg-accent text-bg"> */}
            {/* <Icon name="volume" size={13} /> */}
          {/* </span> */}
          {/* <h1 className="text-[13px] font-medium tracking-tight text-ink">Player</h1> */}
          {/* <span className="text-[11px] text-ink-faint">Online radio, equalised</span> */}
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" onClick={() => setAboutOpen(true)}>
              Shortcuts &amp; quality
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <FilterSidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <Toolbar
              onAddStation={() => openEditor(null)}
              onBrowseDirectory={() => setDirectoryOpen(true)}
              onNotify={notify}
            />
            <StationTable
              onEditStation={openEditor}
              onBrowseDirectory={() => setDirectoryOpen(true)}
            />
          </main>
        </div>

        {/* The panels are shrink-0 so their controls never squash, but in a short
            window two open panels would otherwise take the whole height and leave
            the station list with none. Cap them and let them scroll. */}
        {eqOpen && (
          <div className="flex max-h-[55%] shrink-0 flex-wrap overflow-y-auto bg-bg-raised scrollbar-thin">
            <EqualizerPanel />
            <SpacePanel />
          </div>
        )}
        <PlayerBar eqOpen={eqOpen} onToggleEq={() => setEqOpen(!eqOpen)} />
      </div>

      <StationDialog
        open={stationDialogOpen}
        onOpenChange={setStationDialogOpen}
        station={editing}
        onNotify={notify}
      />
      <DirectoryDialog
        open={directoryOpen}
        onOpenChange={setDirectoryOpen}
        onNotify={notify}
      />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      {message && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-line bg-panel px-3.5 py-2 text-[13px] text-ink shadow-xl"
        >
          {message}
        </div>
      )}
    </Tooltip.Provider>
  )
}

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play or stop the current station'],
  ['← / →', 'Previous / next station in the list'],
  ['↑ / ↓', 'Volume'],
  ['M', 'Mute'],
  ['E', 'Show or hide the equalizer'],
  ['B', 'Browse the station directory'],
  ['0', 'Reset the equalizer to flat'],
  ['/', 'Focus the filter box'],
]

function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Shortcuts and audio quality"
      className="w-[min(92vw,560px)]"
    >
      <div className="flex flex-col gap-5 p-4">
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Keyboard
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            {SHORTCUTS.map(([key, desc]) => (
              <div key={key} className="contents">
                <dt className="rounded border border-line bg-panel px-1.5 py-0.5 text-center font-mono text-[11px] text-ink-dim">
                  {key}
                </dt>
                <dd className="text-ink-dim">{desc}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-dim">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Why some stations have no equalizer
          </h3>
          <p>
            Processing audio in the browser requires the station's server to allow it with a CORS
            header. Most do, but not all. A station that refuses still plays — it just bypasses the
            filter bank, the effects rack and the visualizer, and is marked{' '}
            <span className="text-warn">Play only</span>.
          </p>
          <p>
            Separately, a browser on an <code className="font-mono text-ink">https</code> page will
            not open a plain <code className="font-mono text-ink">http</code> stream at all. Roughly
            40% of the directory's most popular stations are http-only. This app automatically
            retries those over https, which rescues many of them; the rest are marked{' '}
            <span className="text-bad">Blocked</span>. Running the app locally over{' '}
            <code className="font-mono text-ink">http://localhost</code> sidesteps the restriction
            entirely.
          </p>
        </section>
      </div>
    </Dialog>
  )
}
