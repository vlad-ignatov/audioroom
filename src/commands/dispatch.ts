import { desktop, type ContextMenuItem } from '@/lib/desktop'
import {
  allCommands,
  contributionsOf,
  getCommand,
  isEnabled,
  labelOf,
  runRef,
  type CommandRef,
  type MenuEntry,
} from './registry'

/**
 * Turns key presses and right-clicks into commands. Installed once, on the
 * window, so it sees every event after the elements on its way have
 * contributed their commands.
 */

const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/**
 * Controls that already act on a key themselves.
 *
 * A focused <button> is activated by space and Enter, a slider thumb by the
 * arrows, a menu by both. Running a command as well fires the action twice —
 * pressing space on a focused row button paused and immediately resumed,
 * restarting the stream. `closest` rather than the target itself, because
 * focus often sits on a child of the widget that owns the key.
 */
const KEY_ACTIVATES = [
  'button',
  'summary',
  'a[href]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
].join(', ')

const ARROWS_NAVIGATE = [
  '[role="slider"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="listbox"]',
  '[role="combobox"]',
  '[role="tablist"]',
  '[role="radiogroup"]',
  'a[href]',
].join(', ')

/**
 * Surfaces that take over the keyboard while they are open.
 *
 * A dialog or an open menu owns every key until it closes, so no command
 * should fire behind one. Testing the focused element is not enough: an open
 * dropdown can leave focus on <body>, and a freshly opened dialog leaves it on
 * the dialog container — in both cases space fell through and paused
 * playback. These surfaces unmount when closed, so their presence in the
 * document is the dependable signal.
 */
const MODAL_SURFACE = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

function modalIsOpen(): boolean {
  return document.querySelector(MODAL_SURFACE) !== null
}

function focusedControlHandles(target: EventTarget | null, key: string): boolean {
  const el = target instanceof Element ? target : null
  if (!el) return false
  if (el.closest(TEXT_ENTRY)) return true
  if (key === 'Space' || key === 'Enter') return el.closest(KEY_ACTIVATES) !== null
  if (key.startsWith('Arrow')) return el.closest(ARROWS_NAVIGATE) !== null
  return false
}

/** The key as commands name it: letters upper-cased, the space bar as "Space". */
function keyName(e: KeyboardEvent): string {
  if (e.key === ' ') return 'Space'
  return e.key.length === 1 ? e.key.toUpperCase() : e.key
}

/** The contributed commands, innermost first, without separators. */
function contributedRefs(event: Event): CommandRef[] {
  return contributionsOf(event).flatMap((entries) =>
    entries().filter((e): e is CommandRef => typeof e === 'object' && e !== null),
  )
}

/**
 * Run a command from the keyboard without losing the keyboard's place.
 *
 * Removing the focused row (Delete in the queue) would drop focus to the
 * page, and arrow keys and Delete would stop working on the list. If that
 * happens, focus moves to the row that took the removed one's place, or to
 * the new last row.
 */
function runKeepingFocus(ref: CommandRef, from: Element | null): void {
  const index = from instanceof HTMLElement ? from.dataset.index : undefined
  const list = from?.closest('[role="grid"], [role="treegrid"]')
  runRef(ref)
  if (index === undefined || !list) return
  requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body) return
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-index]'))
    ;(rows.find((r) => r.dataset.index === index) ?? rows[rows.length - 1])?.focus()
  })
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
  if (modalIsOpen()) return
  const key = keyName(e)
  if (focusedControlHandles(e.target, key)) return

  // The focused element's commands first: Enter on a row plays that row.
  for (const ref of contributedRefs(e)) {
    if (getCommand(ref.id)?.keys?.includes(key) && isEnabled(ref)) {
      e.preventDefault()
      runKeepingFocus(ref, e.target instanceof Element ? e.target : null)
      return
    }
  }
  for (const [id, def] of allCommands()) {
    if (def.global && def.keys?.includes(key)) {
      e.preventDefault()
      runRef({ id: id as CommandRef['id'], args: undefined })
      return
    }
  }
}

// ------------------------------------------------------------ context menu ---

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

/** Electron's name for a key, for the shortcut shown beside a menu item. */
function accelerator(keys: string[] | undefined): string | undefined {
  if (!keys?.length) return undefined
  const shown = isMac && keys.includes('Backspace') ? 'Backspace' : keys[0]!
  const names: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Return',
  }
  return names[shown] ?? shown
}

/** What a text field offers: the editing commands of the platform's own menu. */
function editItems(target: Element): ContextMenuItem[] {
  const field = target.closest(TEXT_ENTRY)
  if (!field) return []
  return [
    { type: 'role', role: 'cut' },
    { type: 'role', role: 'copy' },
    { type: 'role', role: 'paste' },
    { type: 'separator' },
    { type: 'role', role: 'selectAll' },
  ]
}

/**
 * Lay out the collected groups: innermost first, a separator between
 * contributors, and each command once — where it is most specific.
 */
function buildMenu(event: Event): { items: ContextMenuItem[]; refs: CommandRef[] } {
  const items: ContextMenuItem[] = []
  const refs: CommandRef[] = []
  const seen = new Set<string>()
  const separate = () => {
    if (items.length > 0 && items[items.length - 1]!.type !== 'separator') items.push({ type: 'separator' })
  }

  if (event.target instanceof Element) items.push(...editItems(event.target))
  for (const entries of contributionsOf(event)) {
    separate()
    for (const entry of entries() as MenuEntry[]) {
      if (!entry) continue
      if (entry === '-') {
        separate()
        continue
      }
      const def = getCommand(entry.id)
      if (!def || seen.has(entry.id)) continue
      seen.add(entry.id)
      const checked = def.checked?.(entry.args)
      items.push({
        type: checked === undefined ? 'normal' : 'checkbox',
        id: refs.length,
        label: labelOf(entry),
        enabled: isEnabled(entry),
        checked,
        accelerator: accelerator(def.keys),
      })
      refs.push(entry)
    }
  }
  while (items.length > 0 && items[items.length - 1]!.type === 'separator') items.pop()
  return { items, refs }
}

function onContextMenu(e: MouseEvent): void {
  // A plain browser keeps its own menu; only the desktop app shows ours.
  const bridge = desktop
  if (!bridge) return
  const { items, refs } = buildMenu(e)
  if (items.length === 0) return
  e.preventDefault()
  void bridge.showContextMenu(items, { x: e.clientX, y: e.clientY }).then((chosen) => {
    const ref = chosen === null ? undefined : refs[chosen]
    if (ref) runRef(ref)
  })
}

let installed = false

export function installCommandDispatch(): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('contextmenu', onContextMenu)
}
