import { useEffect, useMemo, useState } from 'react'
import { desktop, type ScannedTags, type TagEdit } from '@/lib/desktop'
import { suggestFix } from '@/lib/encoding'
import { useLocalLibrary } from '@/store/localLibrary'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { Progress } from './EncodingFixDialog'

const field =
  'h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] text-ink placeholder:text-ink-faint disabled:opacity-50'
const label = 'text-[11px] font-medium uppercase tracking-wide text-ink-faint'

const FIELDS = ['artist', 'album'] as const
type Field = (typeof FIELDS)[number]
const LABELS: Record<Field, string> = { artist: 'Artist', album: 'Album' }

type Stage =
  | { name: 'scanning'; done: number; total: number }
  | { name: 'edit' }
  | { name: 'applying'; done: number; total: number }
  | { name: 'done'; written: number; failed: { name: string; message: string }[] }
  | { name: 'error'; message: string }

interface Props {
  folder: string | null
  onClose: () => void
}

function cleanError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** The distinct values of a field across files, most common first; '' for missing. */
function distinct(files: ScannedTags[], key: Field): { value: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const f of files) {
    const v = f[key] ?? ''
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
}

/**
 * Set the artist and/or album on every MP3 in a folder.
 *
 * Each field is opt-in: an unticked field is not written at all, so setting
 * the album never flattens a compilation's per-track artists.
 */
export function FolderTagsDialog({ folder, onClose }: Props) {
  const [recursive, setRecursive] = useState(false)
  const [stage, setStage] = useState<Stage>({ name: 'scanning', done: 0, total: 0 })
  const [files, setFiles] = useState<ScannedTags[]>([])
  const [enabled, setEnabled] = useState<Record<Field, boolean>>({ artist: false, album: false })
  const [values, setValues] = useState<Record<Field, string>>({ artist: '', album: '' })

  useEffect(() => {
    if (!folder || !desktop) return
    let live = true
    setStage({ name: 'scanning', done: 0, total: 0 })
    desktop
      .scanTags(folder, (p) => live && setStage({ name: 'scanning', ...p }), recursive)
      .then((scanned) => {
        if (!live) return
        setFiles(scanned)
        // Start from the most common value, repaired if it is mis-encoded, so
        // the usual edit is a tick and a click.
        const initial = { artist: '', album: '' }
        for (const key of FIELDS) {
          const top = distinct(scanned, key)[0]?.value ?? ''
          initial[key] = suggestFix(top) ?? top
        }
        setValues(initial)
        setEnabled({ artist: false, album: false })
        setStage({ name: 'edit' })
      })
      .catch((err) => live && setStage({ name: 'error', message: cleanError(err) }))
    return () => {
      live = false
    }
  }, [folder, recursive])

  const summaries = useMemo(
    () => Object.fromEntries(FIELDS.map((key) => [key, distinct(files, key)])) as Record<Field, ReturnType<typeof distinct>>,
    [files],
  )

  /** Files a write would actually change. */
  const affected = useMemo(
    () => files.filter((f) => FIELDS.some((key) => enabled[key] && (f[key] ?? '') !== values[key].trim())),
    [files, enabled, values],
  )

  async function apply() {
    const bridge = desktop
    if (!bridge) return
    const edit: TagEdit = {}
    for (const key of FIELDS) if (enabled[key]) edit[key] = values[key]
    const failed: { name: string; message: string }[] = []
    const written: string[] = []
    setStage({ name: 'applying', done: 0, total: affected.length })
    for (const [i, file] of affected.entries()) {
      try {
        await bridge.writeTags(file.path, edit)
        written.push(file.path)
      } catch (err) {
        failed.push({ name: file.path.split(/[\\/]/).pop() ?? file.path, message: cleanError(err) })
      }
      setStage({ name: 'applying', done: i + 1, total: affected.length })
    }
    useLocalLibrary.getState().retag(written)
    setStage({ name: 'done', written: written.length, failed })
  }

  const folderName = folder?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const busy = stage.name === 'scanning' || stage.name === 'applying'

  return (
    <Dialog
      open={folder !== null}
      onOpenChange={(open) => !open && stage.name !== 'applying' && onClose()}
      title={`Edit info of every file in “${folderName}”`}
      description="Sets the ticked fields on every MP3 file. Unticked fields are left as they are."
      className="w-[min(92vw,560px)]"
      footer={
        stage.name === 'edit' && files.length > 0 ? (
          <>
            <span className="mr-auto text-[12px] text-ink-faint">
              {affected.length} of {files.length} file{files.length === 1 ? '' : 's'} will change
            </span>
            <Button variant="solid" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="accent" disabled={affected.length === 0} onClick={() => void apply()}>
              Write {affected.length} file{affected.length === 1 ? '' : 's'}
            </Button>
          </>
        ) : (
          <Button variant="solid" disabled={busy} onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {(stage.name === 'edit' || stage.name === 'scanning') && (
          <label className="flex items-center gap-2 text-[12px] text-ink-dim">
            <input
              type="checkbox"
              checked={recursive}
              disabled={busy}
              onChange={(e) => setRecursive(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Include subfolders
          </label>
        )}

        {stage.name === 'scanning' && <Progress label="Reading tags…" done={stage.done} total={stage.total} />}
        {stage.name === 'applying' && <Progress label="Writing tags…" done={stage.done} total={stage.total} />}
        {stage.name === 'error' && <p className="text-[13px] text-bad">{stage.message}</p>}
        {stage.name === 'done' && (
          <div className="flex flex-col gap-2 text-[13px]">
            <p className="text-ink">
              Updated {stage.written} file{stage.written === 1 ? '' : 's'}.
            </p>
            {stage.failed.length > 0 && (
              <>
                <p className="text-bad">{stage.failed.length} could not be written:</p>
                <ul className="flex flex-col gap-1 text-[12px] text-ink-dim">
                  {stage.failed.map((f) => (
                    <li key={f.name}>
                      {f.name}: <span className="text-ink-faint">{f.message}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {stage.name === 'edit' && files.length === 0 && (
          <p className="text-[13px] text-ink-dim">
            No MP3 files here.{recursive ? '' : ' Try including subfolders.'}
          </p>
        )}

        {stage.name === 'edit' &&
          files.length > 0 &&
          FIELDS.map((key) => {
            const summary = summaries[key]
            return (
              <div key={key} className="flex flex-col gap-1">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabled[key]}
                    onChange={(e) => setEnabled({ ...enabled, [key]: e.target.checked })}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className={label}>{LABELS[key]}</span>
                </label>
                <input
                  value={values[key]}
                  disabled={!enabled[key]}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                  placeholder={`Leave empty to remove the ${LABELS[key].toLowerCase()}`}
                  className={field}
                />
                <p className={cn('text-[11px] text-ink-faint', !enabled[key] && 'opacity-60')}>
                  Now:{' '}
                  {summary.length === 1
                    ? summary[0]!.value || 'not set'
                    : `${summary.length} different values: ${summary
                        .slice(0, 3)
                        .map((s) => `${s.value || 'not set'} (${s.count})`)
                        .join(', ')}${summary.length > 3 ? ', …' : ''}`}
                </p>
              </div>
            )
          })}
      </div>
    </Dialog>
  )
}
