import { useEffect } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
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
import { useUi, type View } from '@/store/ui'
import { installCommandDispatch } from '@/commands'
import { cn } from '@/lib/utils'

export default function App() {
  const eqOpen = useEq((s) => s.panelOpen)
  const setEqOpen = useEq((s) => s.setPanelOpen)
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const directoryOpen = useUi((s) => s.directoryOpen)
  const shortcutsOpen = useUi((s) => s.shortcutsOpen)
  const stationEditor = useUi((s) => s.stationEditor)
  const message = useUi((s) => s.toast)
  const { notify, setDirectoryOpen, setShortcutsOpen, editStation, closeStationEditor } = useUi.getState()

  useEffect(() => {
    void useLocalLibrary.getState().loadRoots()
    installCommandDispatch()
    // Coming back to the window — typically from reconnecting a share in
    // Finder — is the moment to look again at what could not be read.
    const recover = () => useLocalLibrary.getState().retryFailed()
    window.addEventListener('focus', recover)
    return () => window.removeEventListener('focus', recover)
  }, [])

  // Native menu items and hardware media keys.
  useDesktopIntegration()

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
                  onAddStation={() => editStation(null)}
                  onBrowseDirectory={() => setDirectoryOpen(true)}
                  onNotify={notify}
                />
                <StationTable onBrowseDirectory={() => setDirectoryOpen(true)} />
              </main>
            </>
          ) : (
            <main className="flex min-w-0 flex-1 flex-col">
              <LocalToolbar />
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
        open={stationEditor.open}
        onOpenChange={(open) => (open ? editStation(stationEditor.station) : closeStationEditor())}
        station={stationEditor.station}
        onNotify={notify}
      />
      <DirectoryDialog
        open={directoryOpen}
        onOpenChange={setDirectoryOpen}
        onNotify={notify}
      />
      <AboutDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

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

const TABS: Array<{ id: View; label: string }> = [
  { id: 'radio', label: 'Internet radio' },
  { id: 'local', label: 'Local library' },
]

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
