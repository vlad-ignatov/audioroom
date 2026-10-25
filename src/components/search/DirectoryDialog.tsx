import { useEffect, useMemo, useRef, useState } from 'react'
import type { Station } from '@/types/station'
import { searchStations, topStations, type SearchOrder } from '@/api/radioBrowser'
import { useLibrary } from '@/store/library'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

const ORDERS: Array<{ value: SearchOrder; label: string }> = [
  { value: 'votes', label: 'Most voted' },
  { value: 'clickcount', label: 'Most played' },
  { value: 'bitrate', label: 'Highest bitrate' },
  { value: 'name', label: 'Name' },
  { value: 'random', label: 'Random' },
]

export function DirectoryDialog({
  open,
  onOpenChange,
  onNotify,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onNotify: (message: string) => void
}) {
  const { addStations, stations } = useLibrary()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [order, setOrder] = useState<SearchOrder>('votes')
  const [httpsOnly, setHttpsOnly] = useState(location.protocol === 'https:')
  const [results, setResults] = useState<Station[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const owned = useMemo(
    () => new Set(stations.map((s) => s.url.replace(/\/+$/, '').toLowerCase())),
    [stations],
  )

  useEffect(() => {
    if (!open) return
    const id = ++requestId.current
    const term = query.trim()
    setLoading(true)
    setError(null)

    const timer = setTimeout(async () => {
      try {
        const data =
          term === '' && tag === ''
            ? await topStations(200)
            : await searchStations({ name: term, tag: tag.trim(), order, limit: 300, httpsOnly })
        if (id !== requestId.current) return
        setResults(httpsOnly ? data.filter((s) => s.url.startsWith('https:')) : data)
      } catch {
        if (id !== requestId.current) return
        setError('Could not reach radio-browser.info. Check your connection and try again.')
        setResults([])
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    }, term || tag ? 350 : 0)

    return () => clearTimeout(timer)
  }, [open, query, tag, order, httpsOnly])

  const newOnes = results.filter((s) => !owned.has(s.url.replace(/\/+$/, '').toLowerCase()))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Browse stations"
      description="Search radio-browser.info, a community-maintained index of about 50,000 stations."
      className="w-[min(94vw,860px)] h-[80vh]"
      footer={
        <>
          <span className="mr-auto text-xs text-ink-faint">
            {loading ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'}`}
          </span>
          <Button variant="solid" onClick={() => onOpenChange(false)}>
            Done
          </Button>
          <Button
            variant="accent"
            disabled={newOnes.length === 0}
            onClick={() => {
              const n = addStations(newOnes)
              onNotify(`Added ${n} station${n === 1 ? '' : 's'} to your library.`)
            }}
          >
            Add all {newOnes.length > 0 ? newOnes.length : ''}
          </Button>
        </>
      }
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line-soft bg-bg-raised px-4 py-3">
        <div className="relative min-w-48 flex-1">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            aria-label="Search station names"
            className="h-8 w-full rounded-md border border-line bg-bg pl-8 pr-2 text-[13px] text-ink placeholder:text-ink-faint"
          />
        </div>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="Tag, e.g. jazz"
          aria-label="Filter by tag"
          className="h-8 w-36 rounded-md border border-line bg-bg px-2.5 text-[13px] text-ink placeholder:text-ink-faint"
        />
        <select
          value={order}
          onChange={(e) => setOrder(e.target.value as SearchOrder)}
          aria-label="Sort results"
          className="h-8 rounded-md border border-line bg-bg px-2 text-[12px] text-ink-dim"
        >
          {ORDERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-dim">
          <input
            type="checkbox"
            checked={httpsOnly}
            onChange={(e) => setHttpsOnly(e.target.checked)}
            className="accent-[oklch(0.79_0.15_78)]"
          />
          https only
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-bad">
          <Icon name="warning" size={16} />
          {error}
        </div>
      )}

      <ul className="divide-y divide-[var(--color-line-soft)]">
        {results.map((s) => {
          const already = owned.has(s.url.replace(/\/+$/, '').toLowerCase())
          return (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink">{s.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                  {s.country && <span className="truncate">{s.country}</span>}
                  {s.codec && <span className="font-mono">{s.codec}</span>}
                  {s.bitrate ? <span className="tabular-nums">{s.bitrate}k</span> : null}
                  {s.isHls && <span className="rounded bg-panel px-1">HLS</span>}
                  {!s.url.startsWith('https:') && (
                    <span className="text-warn">http only</span>
                  )}
                  <span className="truncate">{s.tags.slice(0, 3).join(' · ')}</span>
                </div>
              </div>
              <Button
                size="sm"
                variant={already ? 'ghost' : 'solid'}
                disabled={already}
                onClick={() => {
                  addStations([s])
                  onNotify(`Added ${s.name}.`)
                }}
                className={cn('shrink-0', already && 'text-ink-faint')}
              >
                {already ? (
                  <>
                    <Icon name="check" size={12} /> In library
                  </>
                ) : (
                  <>
                    <Icon name="plus" size={12} /> Add
                  </>
                )}
              </Button>
            </li>
          )
        })}
      </ul>

      {!loading && !error && results.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-ink-faint">
          No stations matched. Try a different name or tag.
        </p>
      )}
    </Dialog>
  )
}
