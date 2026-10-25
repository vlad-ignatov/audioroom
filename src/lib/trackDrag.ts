import { desktop } from './desktop'

/**
 * Drag-and-drop of tracks between the app's lists.
 *
 * Drags carry paths, not tracks: a folder dragged from the tree is walked
 * where it lands, by the same code as a folder dropped from the file manager.
 */

/** Files or folders from the library tree: a JSON array of paths. */
export const PATHS_TYPE = 'application/x-player-paths'

export function setDraggedPaths(e: React.DragEvent, paths: string[]): void {
  e.dataTransfer.setData(PATHS_TYPE, JSON.stringify(paths))
  e.dataTransfer.effectAllowed = 'copy'
  showDragProxy(e)
}

/** How opaque the dragged row's image is. */
const PROXY_OPACITY = 0.5

/** Stands in for the native drag image, which is hidden. Loaded up front: it must be ready at dragstart. */
const blank = new Image()
blank.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

let endProxy: (() => void) | null = null

/**
 * Drag a see-through copy of the row instead of the native drag image.
 *
 * Chromium draws the native image at an opacity of its own choosing, with no
 * way to set it, so it is replaced by a transparent pixel and the row's clone
 * follows the pointer instead. It lives only inside the window (dragover is
 * all there is to track the pointer by), which is where every drop target is.
 */
export function showDragProxy(e: React.DragEvent): void {
  endProxy?.()
  const source = e.currentTarget as HTMLElement
  const rect = source.getBoundingClientRect()
  const dx = e.clientX - rect.left
  const dy = e.clientY - rect.top
  e.dataTransfer.setDragImage(blank, 0, 0)

  const proxy = source.cloneNode(true) as HTMLElement
  proxy.removeAttribute('id')
  proxy.setAttribute('aria-hidden', 'true')
  Object.assign(proxy.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    opacity: String(PROXY_OPACITY),
    pointerEvents: 'none',
    zIndex: '1000',
    background: 'var(--color-bg-raised)',
    transform: `translate(${rect.left}px, ${rect.top}px)`,
  })
  document.body.appendChild(proxy)

  const move = (ev: DragEvent) => {
    // Chromium sends a last dragover at 0,0 as the pointer leaves the window.
    if (ev.clientX === 0 && ev.clientY === 0) return
    proxy.style.transform = `translate(${ev.clientX - dx}px, ${ev.clientY - dy}px)`
    proxy.style.visibility = 'visible'
  }
  const leave = (ev: DragEvent) => {
    if (ev.relatedTarget === null) proxy.style.visibility = 'hidden'
  }
  const end = () => {
    proxy.remove()
    document.removeEventListener('dragover', move, true)
    document.removeEventListener('dragleave', leave, true)
    document.removeEventListener('drop', end, true)
    document.removeEventListener('dragend', end, true)
    document.removeEventListener('mousemove', end, true)
    if (endProxy === end) endProxy = null
  }
  endProxy = end
  document.addEventListener('dragover', move, true)
  document.addEventListener('dragleave', leave, true)
  document.addEventListener('drop', end, true)
  // dragend goes to the source row, which may have been scrolled out of the
  // list (and out of the document) by then; no mouse events fire during a
  // drag, so the first one after it is the backstop.
  document.addEventListener('dragend', end, true)
  requestAnimationFrame(() => document.addEventListener('mousemove', end, true))
}

/**
 * Whether a drag carries paths: from the tree, or files from the OS.
 * Only the types are readable until the drop.
 */
export function carriesPaths(e: React.DragEvent): boolean {
  const types = e.dataTransfer.types
  return types.includes(PATHS_TYPE) || types.includes('Files')
}

/** The paths a drop carries, from the tree or from the file manager. */
export function droppedPaths(e: React.DragEvent): string[] {
  const raw = e.dataTransfer.getData(PATHS_TYPE)
  if (raw) {
    try {
      const list = JSON.parse(raw) as unknown
      return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
    } catch {
      return []
    }
  }
  if (!desktop) return []
  return Array.from(e.dataTransfer.files)
    .map((file) => desktop!.pathForFile(file))
    .filter(Boolean)
}
