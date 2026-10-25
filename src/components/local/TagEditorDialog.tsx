import { useEffect, useState } from 'react'
import { desktop, type DirFile, type TagEdit } from '@/lib/desktop'
import { suggestFix } from '@/lib/encoding'
import { useLocalLibrary } from '@/store/localLibrary'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'

const field =
  'h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] text-ink placeholder:text-ink-faint'
const label = 'text-[11px] font-medium uppercase tracking-wide text-ink-faint'

type Values = Required<TagEdit>
const TEXT_FIELDS = ['title', 'artist', 'album'] as const
const LABELS: Record<keyof Values, string> = { title: 'Title', artist: 'Artist', album: 'Album' }

interface Props {
  file: DirFile | null
  onClose: () => void
  onNotify: (message: string) => void
}

export function TagEditorDialog({ file, onClose, onNotify }: Props) {
  const [initial, setInitial] = useState<Values | null>(null)
  const [values, setValues] = useState<Values | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Read the tags fresh rather than trusting what is on screen: the row may
  // not have been tagged yet, and the file may have changed since.
  useEffect(() => {
    setInitial(null)
    setValues(null)
    setError(null)
    if (!file || !desktop) return
    let live = true
    void desktop.readTags([file.path]).then(([tags]) => {
      if (!live) return
      const read: Values = {
        title: tags?.title ?? '',
        artist: tags?.artist ?? '',
        album: tags?.album ?? '',
      }
      setInitial(read)
      setValues(read)
    })
    return () => {
      live = false
    }
  }, [file])

  const editable = file ? /\.mp3$/i.test(file.name) : false
  const fixes = values
    ? TEXT_FIELDS.flatMap((key) => {
        const fixed = suggestFix(values[key])
        return fixed ? [[key, fixed] as const] : []
      })
    : []
  const changed =
    initial && values ? (Object.keys(values) as (keyof Values)[]).filter((k) => values[k] !== initial[k]) : []

  async function save() {
    if (!file || !desktop || !values || changed.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const edit: TagEdit = {}
      for (const key of changed) edit[key] = values[key]
      await desktop.writeTags(file.path, edit)
      useLocalLibrary.getState().retag([file.path])
      onNotify('Tags saved.')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Edit info"
      description={file?.name}
      className="w-[min(92vw,520px)]"
      footer={
        <>
          {fixes.length > 0 && (
            <Button
              variant="solid"
              className="mr-auto"
              onClick={() => setValues((v) => (v ? { ...v, ...Object.fromEntries(fixes) } : v))}
            >
              Fix Cyrillic
            </Button>
          )}
          <Button variant="solid" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" disabled={!editable || changed.length === 0 || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save to file'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {!editable && (
          <p className="text-[12px] text-warn">Only MP3 files can be edited for now.</p>
        )}
        {!values ? (
          <p className="text-[13px] text-ink-faint">Reading tags…</p>
        ) : (
          <>
            {TEXT_FIELDS.map((key) => {
              const fixed = suggestFix(values[key])
              // The grid shows the file name when there is no title, which
              // makes an untitled file look titled; say so here.
              const fromName = key === 'title' && !values.title && file ? file.name.replace(/\.[^.]+$/, '') : null
              return (
                <label key={key} className="flex flex-col gap-1">
                  <span className={label}>{LABELS[key]}</span>
                  <input
                    value={values[key]}
                    disabled={!editable}
                    onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                    className={field}
                    autoFocus={key === 'title'}
                    placeholder={fromName ?? undefined}
                  />
                  {fromName && (
                    <button
                      type="button"
                      onClick={() => setValues({ ...values, title: fromName })}
                      className="self-start text-left text-[11px] text-ink-faint hover:text-accent"
                    >
                      No title tag; the list shows the file name. Use it as the title?
                    </button>
                  )}
                  {fixed && (
                    <button
                      type="button"
                      onClick={() => setValues({ ...values, [key]: fixed })}
                      className="self-start text-left text-[11px] text-ink-faint hover:text-accent"
                    >
                      Looks mis-encoded. Use “<span className="text-ink-dim">{fixed}</span>”?
                    </button>
                  )}
                </label>
              )
            })}
          </>
        )}
        {error && <p className="text-[12px] text-bad">{error}</p>}
        {/* Enter in a field submits. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
