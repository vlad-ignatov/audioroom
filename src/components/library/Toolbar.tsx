import { useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ALL_COLUMN_IDS, COLUMNS, useTable } from '@/store/table'
import { useLibrary } from '@/store/library'
import { parsePlaylist, toM3u, download } from '@/lib/playlist'
import { createBackup, parseBackup, type Backup } from '@/lib/backup'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { ImportDialog } from './ImportDialog'

const menuContent =
  'z-50 min-w-52 rounded-lg border border-line bg-panel p-1 shadow-xl'
const menuItem =
  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] text-ink-dim outline-none data-[highlighted]:bg-panel-hi data-[highlighted]:text-ink'

export function Toolbar({
  onAddStation,
  onBrowseDirectory,
  onNotify,
}: {
  onAddStation: () => void
  onBrowseDirectory: () => void
  onNotify: (message: string) => void
}) {
  const { columns, toggleColumn, moveColumn, resetColumns } = useTable()
  const { stations, addStations, resetToSeed } = useLibrary()
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Backup | null>(null)

  async function handleImport(file: File) {
    try {
      const text = await file.text()
      // A JSON file is a backup (or an older stations-only export): it carries
      // user data worth merging, so it gets the full import dialog.
      if (/^\s*[[{]/.test(text)) {
        const backup = parseBackup(text)
        if (backup.stations.length === 0 && Object.keys(backup.settings).length === 0) {
          onNotify('No stations found in that file.')
          return
        }
        setPending(backup)
        return
      }
      const parsed = parsePlaylist(text)
      if (parsed.length === 0) {
        onNotify('No stations found in that file.')
        return
      }
      const added = addStations(parsed)
      onNotify(
        added === parsed.length
          ? `Imported ${added} station${added === 1 ? '' : 's'}.`
          : `Imported ${added}, skipped ${parsed.length - added} already in the library.`,
      )
    } catch {
      onNotify('Could not read that playlist file.')
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2 px-3 bg-bg-raised py-2">
      <Button variant="accent" size="sm" onClick={onBrowseDirectory}>
        <Icon name="globe" size={13} />
        Browse stations
      </Button>
      <Button variant="solid" size="sm" onClick={onAddStation}>
        <Icon name="plus" size={13} />
        Add station
      </Button>

      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm">
              <Icon name="columns" size={13} />
              Columns
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className={menuContent}>
              {ALL_COLUMN_IDS.map((id) => {
                const visible = columns.includes(id)
                const pos = columns.indexOf(id)
                return (
                  <div key={id} className="flex items-center gap-1">
                    <DropdownMenu.CheckboxItem
                      checked={visible}
                      disabled={id === 'name'}
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={() => toggleColumn(id)}
                      className={`${menuItem} flex-1 data-[disabled]:opacity-50`}
                    >
                      <span className="flex h-3.5 w-3.5 items-center justify-center">
                        {visible && <Icon name="check" size={12} className="text-accent" />}
                      </span>
                      {COLUMNS[id].label || 'Favourite'}
                    </DropdownMenu.CheckboxItem>
                    {visible && (
                      <span className="flex shrink-0 pr-1">
                        <button
                          type="button"
                          aria-label={`Move ${COLUMNS[id].label} left`}
                          disabled={pos <= 0}
                          onClick={() => moveColumn(id, -1)}
                          className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-25"
                        >
                          <Icon name="chevronLeft" size={12} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${COLUMNS[id].label} right`}
                          disabled={pos === columns.length - 1}
                          onClick={() => moveColumn(id, 1)}
                          className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-25"
                        >
                          <Icon name="chevronRight" size={12} />
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item className={menuItem} onSelect={resetColumns}>
                Reset to defaults
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm">
              <Icon name="download" size={13} />
              Library
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className={menuContent}>
              <DropdownMenu.Item className={menuItem} onSelect={() => fileInput.current?.click()}>
                <Icon name="upload" size={13} />
                Import backup, M3U or PLS…
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={menuItem}
                onSelect={() => download('stations.m3u', toM3u(stations), 'audio/x-mpegurl')}
              >
                <Icon name="download" size={13} />
                Export as M3U
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={menuItem}
                onSelect={() =>
                  download(
                    `player-backup-${new Date().toISOString().slice(0, 10)}.json`,
                    createBackup(stations),
                    'application/json',
                  )
                }
              >
                <Icon name="download" size={13} />
                Export backup (JSON)
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item
                className={`${menuItem} text-bad data-[highlighted]:text-bad`}
                onSelect={() => {
                  if (confirm('Replace your library with the built-in starter stations?')) {
                    resetToSeed()
                    onNotify('Library reset to the starter stations.')
                  }
                }}
              >
                <Icon name="trash" size={13} />
                Reset library…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <input
          ref={fileInput}
          type="file"
          accept=".m3u,.m3u8,.pls,.json,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImport(file)
            e.target.value = ''
          }}
        />
        <ImportDialog backup={pending} onClose={() => setPending(null)} onNotify={onNotify} />
      </div>
    </div>
  )
}
