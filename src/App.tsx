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
import { LocalToolbar } from '@/components/local/LocalToolbar'
import { LocalTree } from '@/components/local/LocalTree'
import { useLocalLibrary } from '@/store/localLibrary'
import { useDesktopIntegration } from '@/hooks/useDesktopIntegration'
import { cn } from '@/lib/utils'

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

type View = 'radio' | 'local'

const VIEW_KEY = 'app.view'

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'local' ? 'local' : 'radio'
  } catch {
    return 'radio'
  }
}

const TABS: Array<{ id: View; label: string }> = [
  { id: 'radio', label: 'Internet radio' },
  { id: 'local', label: 'Local library' },
]

export default function App() {
  const eqOpen = useEq((s) => s.panelOpen)
  const setEqOpen = useEq((s) => s.setPanelOpen)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [editing, setEditing] = useState<Station | null>(null)
  const [stationDialogOpen, setStationDialogOpen] = useState(false)
  const { message, notify } = useToast()
  const [view, setViewState] = useState<View>(loadView)

  const setView = useCallback((next: View) => {
    setViewState(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // The last tab is a convenience.
    }
  }, [])

  useEffect(() => {
    void useLocalLibrary.getState().loadRoots()
    // Coming back to the window — typically from reconnecting a share in
    // Finder — is the moment to look again at what could not be read.
    const recover = () => useLocalLibrary.getState().retryFailed()
    window.addEventListener('focus', recover)
    return () => window.removeEventListener('focus', recover)
  }, [])

  const openEditor = useCallback((s: Station | null) => {
    setEditing(s)
    setStationDialogOpen(true)
  }, [])

  // Native menu items and hardware media keys.
  const openDirectory = useCallback(() => setDirectoryOpen(true), [])
  const addStation = useCallback(() => openEditor(null), [openEditor])
  // Files belong to the local library now; the radio library holds stations.
  const addFiles = useCallback(() => {
    setView('local')
    void useLocalLibrary.getState().addFiles().then((message) => message && notify(message))
  }, [setView, notify])
  const addFolder = useCallback(() => {
    setView('local')
    void useLocalLibrary.getState().addFolder().then((message) => message && notify(message))
  }, [setView, notify])
  const showShortcuts = useCallback(() => setAboutOpen(true), [])
  useDesktopIntegration({
    onOpenDirectory: openDirectory,
    onAddStation: addStation,
    onAddFiles: addFiles,
    onAddFolder: addFolder,
    onShowShortcuts: showShortcuts,
    onShowView: setView,
  })

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
        <header className="app-titlebar flex h-9 shrink-0 items-end gap-1 border-b border-line px-3">
          <div role="tablist" aria-label="Library" className="flex h-full items-end gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                onClick={() => setView(tab.id)}
                className={cn(
                  '-mb-px h-8 rounded-t-md border border-b-0 px-3 text-[12px] transition-colors font-semibold pb-1',
                  view === tab.id
                    ? 'border-line bg-bg-raised text-ink bg-gradient-to-b from-line-soft to-bg-raised'
                    : 'border-transparent text-ink-faint hover:text-ink-dim',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {view === 'radio' ? (
            <>
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
            </>
          ) : (
            <main className="flex min-w-0 flex-1 flex-col">
              <LocalToolbar onNotify={notify} />
              <LocalTree onNotify={notify} />
            </main>
          )}
        </div>

        {/* The panels are shrink-0 so their controls never squash, but in a short
            window two open panels would otherwise take the whole height and leave
            the station list with none. Cap them and let them scroll. */}
        {eqOpen && (
          <div className="flex max-h-[55%] shrink-0 flex-wrap overflow-y-auto bg-gradient-to-b from-panel to-bg scrollbar-thin">
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
  ['B', 'Browse stations'],
  ['0', 'Reset the equalizer to flat'],
  ['/', 'Focus the filter box'],
  ['Ctrl 1 / 2', 'Internet radio / local library'],
  ['Ctrl /', 'Show this list'],
]

function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
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
      </div>
    </Dialog>
  )
}
