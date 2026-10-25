/**
 * Commands: everything the user can do, defined once.
 *
 * A command is an id, a label, the keys that run it and a function. Buttons,
 * shortcuts, the menu bar, media keys and context menus all run commands by
 * id, so "Play" behaves the same wherever it is chosen and shows the same
 * shortcut wherever it is listed.
 *
 * Some commands act on a subject — a track, a folder, a station — passed as
 * arguments. The subject comes from where the command was invoked: elements
 * on screen *contribute* commands, with their arguments, to events passing
 * through them (see `commandScope`). A right-click on a queue row collects the
 * row's commands, then the queue's, then anything further out, and the menu
 * is built from that; a key pressed on a focused row looks through the same
 * collection for a command bound to that key.
 *
 * Each module that defines commands declares their argument types by adding
 * to `CommandArgs`, so `run('track.play', args)` is type-checked against them.
 */

// Augmented by the modules that define commands; `void` for no arguments.
export interface CommandArgs {}

export type CommandId = keyof CommandArgs

type ArgsTuple<K extends CommandId> = CommandArgs[K] extends void ? [] : [args: CommandArgs[K]]

export interface CommandDef<A> {
  label: string | ((args: A) => string)
  /**
   * Keys that run it, as `KeyboardEvent.key` with letters upper-cased and the
   * space bar as "Space". Unmodified keys only: modified ones belong to the
   * menu bar. The first is the one menus show (on macOS, Backspace is shown
   * in place of Delete).
   */
  keys?: string[]
  /**
   * Whether the keys work anywhere. Otherwise they work only where the
   * command is contributed — F2 renames the focused row, not "something".
   */
  global?: boolean
  enabled?: (args: A) => boolean
  /** Shown as a checkmark in menus. */
  checked?: (args: A) => boolean
  run: (args: A) => unknown
}

// The map holds every command whatever its arguments; `defineCommands` and
// `run` keep each id paired with its own argument type.
type AnyDef = CommandDef<any>

const registry = new Map<string, AnyDef>()

export function defineCommands<K extends CommandId>(defs: { [P in K]: CommandDef<CommandArgs[P]> }): void {
  for (const [id, def] of Object.entries(defs)) {
    if (registry.has(id)) console.warn(`[commands] ${id} defined twice`)
    registry.set(id, def as AnyDef)
  }
}

export function getCommand(id: string): AnyDef | undefined {
  return registry.get(id)
}

export function allCommands(): [string, AnyDef][] {
  return [...registry.entries()]
}

/** A command bound to its arguments, ready to run or to show in a menu. */
export interface CommandRef {
  id: CommandId
  args: unknown
}

export function cmd<K extends CommandId>(id: K, ...args: ArgsTuple<K>): CommandRef {
  return { id, args: args[0] }
}

export function run<K extends CommandId>(id: K, ...args: ArgsTuple<K>): void {
  runRef(cmd(id, ...args))
}

export function runRef(ref: CommandRef): void {
  const def = registry.get(ref.id)
  if (!def) {
    console.warn(`[commands] unknown command ${ref.id}`)
    return
  }
  if (def.enabled && !def.enabled(ref.args)) return
  void Promise.resolve(def.run(ref.args)).catch((err) => console.error(`[commands] ${ref.id} failed`, err))
}

export function labelOf(ref: CommandRef): string {
  const def = registry.get(ref.id)
  if (!def) return ref.id
  return typeof def.label === 'function' ? def.label(ref.args) : def.label
}

export function isEnabled(ref: CommandRef): boolean {
  const def = registry.get(ref.id)
  return !!def && (def.enabled ? def.enabled(ref.args) : true)
}

// ------------------------------------------------------------ contributing ---

/** `'-'` separates groups within one contribution; falsy entries are skipped. */
export type MenuEntry = CommandRef | '-' | false | null | undefined

/** Contributions collected by an event on its way up, innermost first. */
const collected = new WeakMap<Event, Array<() => MenuEntry[]>>()

export function contributionsOf(event: Event): Array<() => MenuEntry[]> {
  return collected.get(event) ?? []
}

/**
 * Props that make an element contribute commands to right-clicks and key
 * presses inside it. `entries` is called only when one of those happens, so
 * labels and enabled states reflect that moment.
 */
export function commandScope(entries: () => MenuEntry[]) {
  const contribute = (e: React.SyntheticEvent) => {
    const list = collected.get(e.nativeEvent)
    if (list) list.push(entries)
    else collected.set(e.nativeEvent, [entries])
  }
  return { onContextMenu: contribute, onKeyDown: contribute }
}
