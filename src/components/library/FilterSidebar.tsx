import { useState } from 'react'
import { useTable } from '@/store/table'
import { useFacets, type Facet } from '@/hooks/useVisibleStations'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

function FacetGroup({
  title,
  facets,
  selected,
  onToggle,
}: {
  title: string
  facets: Facet[]
  selected: string[]
  onToggle: (v: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (facets.length === 0) return null
  const shown = expanded ? facets : facets.slice(0, 8)

  return (
    <div className="flex flex-col">
      <h3 className="px-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {title}
      </h3>
      {shown.map((f) => {
        const on = selected.includes(f.value)
        return (
          <button
            key={f.value}
            type="button"
            onClick={() => onToggle(f.value)}
            aria-pressed={on}
            className={cn(
              'flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-[12px]',
              on ? 'bg-accent/15 text-accent' : 'text-ink-dim hover:bg-ink/5',
            )}
          >
            <span className="truncate capitalize">{f.value}</span>
            <span className="shrink-0 tabular-nums text-[10px] text-ink-faint">{f.count}</span>
          </button>
        )
      })}
      {facets.length > 8 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="px-2 py-0.5 text-left text-[11px] text-ink-faint hover:text-ink-dim"
        >
          {expanded ? 'Show less' : `Show ${facets.length - 8} more`}
        </button>
      )}
    </div>
  )
}

export function FilterSidebar() {
  const { filters, setFilters, clearFilters, toggleFilterValue, savedViews, saveView, applyView, deleteView } =
    useTable()
  const facets = useFacets()
  const [viewName, setViewName] = useState('')

  const active =
    filters.query !== '' ||
    filters.favoritesOnly ||
    filters.tags.length > 0 ||
    filters.countries.length > 0 ||
    filters.codecs.length > 0

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line-soft bg-bg-raised p-3 scrollbar-thin">
      <div className="relative">
        <Icon
          name="search"
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          type="search"
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value })}
          placeholder="Filter stations…"
          aria-label="Filter stations"
          className="h-8 w-full rounded-md border border-line bg-bg pl-8 pr-2 text-[13px] text-ink placeholder:text-ink-faint"
        />
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setFilters({ favoritesOnly: !filters.favoritesOnly })}
          aria-pressed={filters.favoritesOnly}
          className={cn(
            'flex items-center gap-2 rounded px-2 py-1.5 text-[13px] transition-colors',
            filters.favoritesOnly ? 'bg-accent/15 text-accent' : 'text-ink-dim hover:bg-panel',
          )}
        >
          <Icon name="star" size={14} />
          Favorites only
        </button>
      </div>

      {active && (
        <Button size="sm" variant="solid" onClick={clearFilters}>
          <Icon name="x" size={12} />
          Clear all filters
        </Button>
      )}

      <FacetGroup
        title="Tags"
        facets={facets.tags}
        selected={filters.tags}
        onToggle={(v) => toggleFilterValue('tags', v)}
      />
      <FacetGroup
        title="Country"
        facets={facets.countries}
        selected={filters.countries}
        onToggle={(v) => toggleFilterValue('countries', v)}
      />
      <FacetGroup
        title="Codec"
        facets={facets.codecs}
        selected={filters.codecs}
        onToggle={(v) => toggleFilterValue('codecs', v)}
      />

      <div className="mt-auto flex flex-col gap-1 border-t border-line-soft pt-3">
        <h3 className="px-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Saved views
        </h3>
        {savedViews.map((v) => (
          <div key={v.id} className="group flex items-center gap-1">
            <button
              type="button"
              onClick={() => applyView(v.id)}
              className="flex-1 truncate rounded px-2 py-1 text-left text-[12px] text-ink-dim hover:bg-panel"
            >
              {v.name}
            </button>
            <button
              type="button"
              aria-label={`Delete view ${v.name}`}
              onClick={() => deleteView(v.id)}
              className="rounded p-1 text-transparent group-hover:text-ink-faint hover:!text-bad"
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (!viewName.trim()) return
            saveView(viewName)
            setViewName('')
          }}
        >
          <input
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="Save current view…"
            aria-label="Name for the saved view"
            className="h-7 min-w-0 flex-1 rounded border border-line bg-bg px-2 text-[12px] text-ink placeholder:text-ink-faint"
          />
          <Button type="submit" size="sm" variant="solid" disabled={!viewName.trim()}>
            <Icon name="plus" size={12} />
          </Button>
        </form>
      </div>
    </aside>
  )
}
