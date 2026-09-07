import { useEffect, useState } from 'react'
import type { Station } from '@/types/station'
import { useLibrary } from '@/store/library'
import { looksLikeHls } from '@/audio/probe'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { uid } from '@/lib/utils'

const SWATCHES = [
  'transparent',
  'oklch(0.72 0.17 25)',
  'oklch(0.79 0.15 78)',
  'oklch(0.8 0.16 130)',
  'oklch(0.75 0.13 200)',
  'oklch(0.68 0.16 280)',
  'oklch(0.75 0.16 340)',
]

const field =
  'h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] text-ink placeholder:text-ink-faint'
const label = 'text-[11px] font-medium uppercase tracking-wide text-ink-faint'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Null means "create a new station". */
  station: Station | null
  onNotify: (message: string) => void
}

export function StationDialog({ open, onOpenChange, station, onNotify }: Props) {
  const { addStations, updateStation, hasUrl } = useLibrary()
  const [form, setForm] = useState({
    name: '',
    url: '',
    tags: '',
    country: '',
    notes: '',
    color: 'transparent',
  })

  useEffect(() => {
    if (!open) return
    setForm({
      name: station?.name ?? '',
      url: station?.url ?? '',
      tags: station?.tags.join(', ') ?? '',
      country: station?.country ?? '',
      notes: station?.notes ?? '',
      color: station?.color ?? 'transparent',
    })
  }, [open, station])

  const urlValid = /^https?:\/\/.+/i.test(form.url.trim())
  const duplicate = !station && urlValid && hasUrl(form.url.trim())
  const canSave = form.name.trim() !== '' && urlValid && !duplicate

  function save() {
    const tags = form.tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
    const patch = {
      name: form.name.trim(),
      url: form.url.trim(),
      tags,
      country: form.country.trim() || undefined,
      notes: form.notes.trim() || undefined,
      color: form.color === 'transparent' ? undefined : form.color,
      isHls: looksLikeHls(form.url),
    }

    if (station) {
      // Changing the URL invalidates whatever we learned about the old one.
      const urlChanged = patch.url !== station.url
      updateStation(station.id, {
        ...patch,
        ...(urlChanged
          ? { capability: 'unknown' as const, capabilityCheckedAt: undefined, resolvedUrl: undefined }
          : {}),
      })
      onNotify(`Updated ${patch.name}.`)
    } else {
      addStations([
        {
          id: uid(),
          ...patch,
          favorite: false,
          addedAt: Date.now(),
          playCount: 0,
          capability: 'unknown',
        },
      ])
      onNotify(`Added ${patch.name}.`)
    }
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={station ? 'Edit station' : 'Add a station'}
      description="Paste a direct stream URL — an Icecast/Shoutcast endpoint or an .m3u8 playlist."
      className="w-[min(92vw,520px)]"
      footer={
        <>
          <Button variant="solid" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="accent" disabled={!canSave} onClick={save}>
            {station ? 'Save changes' : 'Add station'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSave) save()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className={label}>Name</span>
          <input
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={field}
            placeholder="Station name"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Stream URL</span>
          <input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            className={field}
            placeholder="https://example.com/stream.mp3"
            spellCheck={false}
          />
          {form.url !== '' && !urlValid && (
            <span className="text-[11px] text-bad">Must start with http:// or https://</span>
          )}
          {duplicate && (
            <span className="text-[11px] text-warn">That URL is already in your library.</span>
          )}
          {urlValid && form.url.trim().startsWith('http://') && location.protocol === 'https:' && (
            <span className="text-[11px] text-warn">
              Plain http streams are blocked on an https page. We will try an https upgrade when you
              play it.
            </span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={label}>Country</span>
            <input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Tags</span>
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              className={field}
              placeholder="jazz, ambient"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className={label}>Note</span>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className={field}
            placeholder="Shown under the station name"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={label}>Colour</span>
          <div className="flex gap-1.5">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c === 'transparent' ? 'No colour' : `Colour ${c}`}
                onClick={() => setForm({ ...form, color: c })}
                style={{ background: c === 'transparent' ? undefined : c }}
                className={
                  'h-6 w-6 rounded-full border transition-transform ' +
                  (form.color === c ? 'border-ink scale-110' : 'border-line') +
                  (c === 'transparent' ? ' bg-panel' : '')
                }
              />
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  )
}
