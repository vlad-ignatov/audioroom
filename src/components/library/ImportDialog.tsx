import { useEffect, useState } from 'react'
import type { Station } from '@/types/station'
import { useLibrary, type ImportMode } from '@/store/library'
import {
  commonFolder,
  folderLabel,
  presetsIn,
  remapFolder,
  restoreSettings,
  type Backup,
} from '@/lib/backup'
import { desktop, isLocalFile } from '@/lib/desktop'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

const label = 'text-[11px] font-medium uppercase tracking-wide text-ink-faint'

interface Props {
  /** Null while closed. */
  backup: Backup | null
  onClose: () => void
  onNotify: (message: string) => void
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function ImportDialog({ backup, onClose, onNotify }: Props) {
  const current = useLibrary((s) => s.stations.length)
  const importStations = useLibrary((s) => s.importStations)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [sound, setSound] = useState(false)
  /** The file's stations, with any local-file folders remapped. */
  const [stations, setStations] = useState<Station[]>([])
  /** URLs of local files not found on this machine. */
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const localCount = stations.filter((s) => isLocalFile(s.url)).length
  const presetCount = backup ? presetsIn(backup).length : 0
  const hasSound = backup
    ? (['player.eq', 'player.fx', 'player.leveling'] as const).some((k) => backup.settings[k])
    : false

  async function checkFiles(list: Station[]) {
    const files = list.filter((s) => isLocalFile(s.url)).map((s) => s.url)
    if (!desktop || files.length === 0) {
      setMissing(new Set())
      return
    }
    const exists = await desktop.filesExist(files)
    setMissing(new Set(files.filter((_, i) => !exists[i])))
  }

  useEffect(() => {
    if (!backup) return
    setMode('merge')
    setSound(false)
    setStations(backup.stations)
    setMissing(new Set())
    void checkFiles(backup.stations)
  }, [backup])

  const from = missing.size > 0 ? commonFolder([...missing]) : null

  async function locate() {
    if (!desktop || !from) return
    const to = await desktop.pickFolder(`Where is “${folderLabel(from)}” on this computer?`)
    if (!to) return
    const next = remapFolder(stations, from, to, missing)
    setStations(next)
    await checkFiles(next)
  }

  async function run() {
    if (!backup) return
    setBusy(true)
    try {
      const { added, updated } = importStations(stations, mode)
      await restoreSettings(backup, { sound })
      const parts =
        mode === 'replace'
          ? [`Library replaced with ${plural(added, 'station')}`]
          : [`${added} added`, `${updated} updated`]
      if (presetCount > 0) parts.push(plural(presetCount, 'EQ preset'))
      if (sound) parts.push('sound settings restored')
      onNotify(`Imported: ${parts.join(', ')}.`)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={backup !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Import library"
      description={
        `${plural(stations.length, 'station')}` +
        (presetCount > 0 ? ` and ${plural(presetCount, 'EQ preset')}` : '') +
        ' in this file.'
      }
      className="w-[min(92vw,520px)]"
      footer={
        <>
          <Button variant="solid" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" disabled={busy} onClick={() => void run()}>
            {mode === 'replace' ? 'Replace library' : 'Import'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className={cn(label, 'mb-1.5')}>Stations</legend>
          <Choice
            checked={mode === 'merge'}
            onSelect={() => setMode('merge')}
            title="Merge into my library"
            detail="Adds new stations and updates ones you already have. Favorites, notes and names from the file win; play counts and history combine."
          />
          <Choice
            checked={mode === 'replace'}
            onSelect={() => setMode('replace')}
            title="Replace my library"
            detail={`Your ${plural(current, 'station')} here are removed and the file's take their place.`}
          />
        </fieldset>

        {hasSound && (
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => setSound(e.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] text-ink">Also restore sound settings</span>
              <span className="text-xs leading-relaxed text-ink-faint">
                EQ curve, effects and auto level, replacing this computer's.
                {presetCount > 0 && ' EQ presets are merged by name either way.'}
              </span>
            </span>
          </label>
        )}

        {desktop && localCount > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-line-soft p-3">
            <span className={label}>Local files</span>
            {from ? (
              <>
                <p className="flex items-start gap-2 text-xs leading-relaxed text-warn">
                  <Icon name="warning" size={13} className="mt-0.5 shrink-0" />
                  <span>
                    {missing.size} of {localCount} files are not on this computer. They were in{' '}
                    <span className="font-mono text-ink-dim">{folderLabel(from)}</span>.
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => void locate()}>
                    <Icon name="folder" size={13} />
                    Choose that folder here…
                  </Button>
                  <span className="text-[11px] text-ink-faint">
                    Or import anyway; they will not play until found.
                  </span>
                </div>
              </>
            ) : (
              <p className="flex items-center gap-2 text-xs text-ink-dim">
                <Icon name="check" size={13} className="text-accent" />
                All {plural(localCount, 'file')} found on this computer.
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}

function Choice({
  checked,
  onSelect,
  title,
  detail,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  detail: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
        checked ? 'border-accent/50 bg-accent/10' : 'border-line-soft hover:border-line',
      )}
    >
      <span className={cn('text-[13px]', checked ? 'text-accent' : 'text-ink')}>{title}</span>
      <span className="text-xs leading-relaxed text-ink-faint">{detail}</span>
    </button>
  )
}
