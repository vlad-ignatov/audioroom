import { useEffect, useMemo, useState } from 'react'
import { desktop, type TagEdit } from '@/lib/desktop'
import { suggestFix } from '@/lib/encoding'
import { useLocalLibrary } from '@/store/localLibrary'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

const FIELDS = ['title', 'artist', 'album'] as const
type Field = (typeof FIELDS)[number]

interface Proposal {
  path: string
  /** Path below the scanned folder, for display. */
  relative: string
  changes: { field: Field; from: string; to: string }[]
}

type Stage =
  | { name: 'scanning'; done: number; total: number }
  | { name: 'review' }
  | { name: 'applying'; done: number; total: number }
  | { name: 'done'; written: number; failed: { relative: string; message: string }[] }
  | { name: 'error'; message: string }

interface Props {
  folder: string | null
  onClose: () => void
}

function cleanError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * Scan a folder for tags stored in the wrong encoding, show what the repair
 * would change, and write only what the user ticks.
 */
export function EncodingFixDialog({ folder, onClose }: Props) {
  const [stage, setStage] = useState<Stage>({ name: 'scanning', done: 0, total: 0 })
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!folder || !desktop) return
    let live = true
    setStage({ name: 'scanning', done: 0, total: 0 })
    setProposals([])
    const prefix = folder.replace(/[\\/]+$/, '') + '/'
    desktop
      .scanTags(folder, (p) => live && setStage({ name: 'scanning', ...p }))
      .then((scanned) => {
        if (!live) return
        const found: Proposal[] = []
        for (const file of scanned) {
          const changes = FIELDS.flatMap((field) => {
            const from = file[field]
            const to = suggestFix(from)
            return from && to ? [{ field, from, to }] : []
          })
          if (changes.length > 0) {
            const relative = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path
            found.push({ path: file.path, relative, changes })
          }
        }
        setProposals(found)
        setSelected(new Set(found.map((p) => p.path)))
        setStage({ name: 'review' })
      })
      .catch((err) => live && setStage({ name: 'error', message: cleanError(err) }))
    return () => {
      live = false
    }
  }, [folder])

  const busy = stage.name === 'scanning' || stage.name === 'applying'
  const chosen = useMemo(() => proposals.filter((p) => selected.has(p.path)), [proposals, selected])

  async function apply() {
    const bridge = desktop
    if (!bridge) return
    const failed: { relative: string; message: string }[] = []
    const written: string[] = []
    setStage({ name: 'applying', done: 0, total: chosen.length })
    // One at a time: these are the user's files, often on a slow external
    // disk, and a failure should stop nothing but that one file.
    for (const [i, proposal] of chosen.entries()) {
      const edit: TagEdit = {}
      for (const change of proposal.changes) edit[change.field] = change.to
      try {
        await bridge.writeTags(proposal.path, edit)
        written.push(proposal.path)
      } catch (err) {
        failed.push({ relative: proposal.relative, message: cleanError(err) })
      }
      setStage({ name: 'applying', done: i + 1, total: chosen.length })
    }
    useLocalLibrary.getState().retag(written)
    setStage({ name: 'done', written: written.length, failed })
  }

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const folderName = folder?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

  return (
    <Dialog
      open={folder !== null}
      // Closing mid-write would hide the outcome; the writes carry on anyway.
      onOpenChange={(open) => !open && stage.name !== 'applying' && onClose()}
      title={`Fix encoding in “${folderName}”`}
      description="Tags written as Windows-1251 Cyrillic but read as Latin-1. Only MP3 files, including subfolders."
      className="w-[min(94vw,820px)]"
      footer={
        stage.name === 'review' && proposals.length > 0 ? (
          <>
            <span className="mr-auto text-[12px] text-ink-faint">
              {chosen.length} of {proposals.length} file{proposals.length === 1 ? '' : 's'} selected
            </span>
            <Button variant="solid" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="accent" disabled={chosen.length === 0} onClick={() => void apply()}>
              Write {chosen.length} file{chosen.length === 1 ? '' : 's'}
            </Button>
          </>
        ) : (
          <Button variant="solid" disabled={busy} onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="p-4">
        {stage.name === 'scanning' && (
          <Progress label="Reading tags…" done={stage.done} total={stage.total} />
        )}
        {stage.name === 'applying' && (
          <Progress label="Writing tags…" done={stage.done} total={stage.total} />
        )}
        {stage.name === 'error' && <p className="text-[13px] text-bad">{stage.message}</p>}
        {stage.name === 'done' && (
          <div className="flex flex-col gap-2 text-[13px]">
            <p className="text-ink">
              Fixed {stage.written} file{stage.written === 1 ? '' : 's'}.
            </p>
            {stage.failed.length > 0 && (
              <>
                <p className="text-bad">{stage.failed.length} could not be written:</p>
                <ul className="flex flex-col gap-1 text-[12px] text-ink-dim">
                  {stage.failed.map((f) => (
                    <li key={f.relative}>
                      {f.relative} — <span className="text-ink-faint">{f.message}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {stage.name === 'review' && proposals.length === 0 && (
          <p className="text-[13px] text-ink-dim">No mis-encoded tags found.</p>
        )}
        {stage.name === 'review' && proposals.length > 0 && (
          <div className="flex flex-col">
            <label className="mb-2 flex items-center gap-2 text-[12px] text-ink-dim">
              <input
                type="checkbox"
                checked={chosen.length === proposals.length}
                ref={(el) => {
                  if (el) el.indeterminate = chosen.length > 0 && chosen.length < proposals.length
                }}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(proposals.map((p) => p.path)) : new Set())
                }
                className="accent-[var(--color-accent)]"
              />
              Select all
            </label>
            {proposals.map((p) => (
              <label
                key={p.path}
                className={cn(
                  'flex cursor-pointer gap-2.5 border-t border-line-soft py-2 text-[12px]',
                  !selected.has(p.path) && 'opacity-50',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.path)}
                  onChange={() => toggle(p.path)}
                  className="mt-0.5 shrink-0 accent-[var(--color-accent)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ink-faint">{p.relative}</div>
                  {p.changes.map((c) => (
                    <div key={c.field} className="grid grid-cols-[52px_minmax(0,1fr)_14px_minmax(0,1fr)] items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-ink-faint">{c.field}</span>
                      <span className="truncate text-ink-faint line-through decoration-ink-faint/40">{c.from}</span>
                      <Icon name="chevronRight" size={12} className="text-ink-faint" />
                      <span className="truncate text-ink">{c.to}</span>
                    </div>
                  ))}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}

export function Progress({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 0
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-[12px] text-ink-dim">
        <span>{label}</span>
        {total > 0 && (
          <span className="tabular-nums">
            {done} / {total}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
