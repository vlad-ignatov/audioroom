import { useRef, useState } from 'react'
import { desktop } from '@/lib/desktop'
import { LocalToolbar } from './LocalToolbar'
import { LocalTree } from './LocalTree'
import { PlayQueue } from './PlayQueue'
import { cn } from '@/lib/utils'

const WIDTH_KEY = 'local.queueWidth'
/** Narrower than this and titles truncate to nothing. */
const QUEUE_MIN = 220
/** What the tree keeps however wide the queue is dragged. */
const TREE_MIN = 280
const KEY_STEP = 24

function loadWidth(): number | null {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(n) && n >= QUEUE_MIN ? n : null
  } catch {
    return null
  }
}

function saveWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(WIDTH_KEY)
    else localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
  } catch {
    // The pane width is a convenience.
  }
}

/**
 * The library tree beside the play queue.
 *
 * The queue takes a third of the width until it is resized; from then on it
 * keeps its width in pixels and the tree takes whatever is left, so making the
 * window bigger gives the room to the tree.
 */
export function LocalView({ onNotify }: { onNotify: (message: string) => void }) {
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef<HTMLDivElement>(null)

  if (!desktop) {
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        <LocalTree onNotify={onNotify} />
      </main>
    )
  }

  const clampWidth = (w: number) => {
    const total = containerRef.current?.clientWidth ?? Infinity
    return Math.max(QUEUE_MIN, Math.min(w, total - TREE_MIN))
  }
  /** The width on screen, also while it is still the default third. */
  const current = () => queueRef.current?.getBoundingClientRect().width ?? width ?? QUEUE_MIN

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <LocalToolbar />
      <div ref={containerRef} className="flex min-h-0 flex-1 gap-1 bg-bg-raised">
        <div className="flex min-w-0 flex-1 flex-col bg-bg">
          <LocalTree onNotify={onNotify} />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the queue"
          aria-valuenow={Math.round(width ?? 0) || undefined}
          tabIndex={0}
          title="Drag to resize; double-click to reset"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            setDragging(true)
          }}
          onPointerMove={(e) => {
            if (!dragging) return
            const right = containerRef.current!.getBoundingClientRect().right
            setWidth(clampWidth(right - e.clientX))
          }}
          onPointerUp={(e) => {
            if (!dragging) return
            e.currentTarget.releasePointerCapture(e.pointerId)
            setDragging(false)
            saveWidth(width)
          }}
          onDoubleClick={() => {
            setWidth(null)
            saveWidth(null)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            const next = clampWidth(current() + (e.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP))
            setWidth(next)
            saveWidth(next)
          }}
          className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize outline-none"
        >
          <div
            className={cn(
              'mx-auto h-full w-1 transition-colors group-hover:bg-line group-focus-visible:bg-accent',
              dragging && 'bg-accent group-hover:bg-accent',
            )}
          />
        </div>

        <div
          ref={queueRef}
          className="flex min-w-0 shrink-0 flex-col bg-bg"
          style={{
            width: width ?? 'calc(100% / 3)',
            minWidth: QUEUE_MIN,
            // When the window shrinks, the tree keeps its share before the
            // queue does; the stored width comes back as it grows again.
            maxWidth: `calc(100% - ${TREE_MIN}px)`,
          }}
        >
          <PlayQueue onNotify={onNotify} />
        </div>
      </div>
    </main>
  )
}
