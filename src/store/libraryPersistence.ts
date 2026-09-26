import type { Station } from '@/types/station'
import { desktop, type DesktopBridge, type LibraryWrite } from '@/lib/desktop'
import { dedupe, useLibrary } from './library'
import { seedStations } from './seed'

/**
 * Where the library was kept before SQLite, in zustand's persist format:
 * `{ state: { stations }, version }`. Still the store in a plain browser.
 */
const LOCAL_KEY = 'player.library'

function readLocal(): Station[] | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return null
    const stations = (JSON.parse(raw) as { state?: { stations?: unknown } }).state?.stations
    // Libraries saved before the id check existed can hold duplicates.
    return Array.isArray(stations) ? dedupe(stations as Station[]) : null
  } catch {
    return null
  }
}

function writeLocal(stations: Station[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ state: { stations }, version: 2 }))
  } catch (err) {
    // Over quota, most likely: the reason the desktop app moved to SQLite.
    console.error('[library] could not save to localStorage', err)
  }
}

/**
 * The rows to write for one change to the library.
 *
 * Stations are replaced, never mutated, so an object that is not the one
 * stored last time is exactly a row that changed. Position is written only
 * when order actually moved: removing a row leaves the others in order, and
 * new rows at the end take the next free position. Anything else — a drag,
 * an import that replaced the list — renumbers everything.
 */
function diff(prev: Station[], next: Station[], end: number): { ops: LibraryWrite; end: number } {
  const before = new Map(prev.map((s) => [s.id, s]))
  const nextIds = new Set(next.map((s) => s.id))
  const remove = prev.filter((s) => !nextIds.has(s.id)).map((s) => s.id)
  const kept = prev.filter((s) => nextIds.has(s.id))

  let inOrder = true
  let k = 0
  let sawNew = false
  for (const s of next) {
    if (!before.has(s.id)) {
      sawNew = true
    } else if (sawNew || kept[k++]!.id !== s.id) {
      inOrder = false
      break
    }
  }

  const ops: Required<Pick<LibraryWrite, 'upsert' | 'update' | 'remove' | 'reposition'>> = {
    upsert: [],
    update: [],
    remove,
    reposition: [],
  }
  if (inOrder) {
    for (const s of next) {
      const old = before.get(s.id)
      if (!old) ops.upsert.push({ station: s, position: end++ })
      else if (old !== s) ops.update.push(s)
    }
    return { ops, end }
  }
  next.forEach((s, position) => {
    const old = before.get(s.id)
    if (old === s) ops.reposition.push({ id: s.id, position })
    else ops.upsert.push({ station: s, position })
  })
  return { ops, end: next.length }
}

function isEmpty(ops: LibraryWrite): boolean {
  return !ops.upsert?.length && !ops.update?.length && !ops.remove?.length && !ops.reposition?.length
}

async function initDesktop(bridge: DesktopBridge): Promise<void> {
  let { initialized, stations, nextPosition } = await bridge.library.load()

  if (!initialized) {
    // First launch with SQLite: bring the localStorage library across, or
    // start a new one. The old copy is deleted only once the new one is
    // safely written.
    stations = readLocal() ?? seedStations()
    await bridge.library.write({
      reset: true,
      upsert: stations.map((station, position) => ({ station, position })),
    })
    nextPosition = stations.length
    localStorage.removeItem(LOCAL_KEY)
  }

  useLibrary.setState({ stations })
  let end = nextPosition
  useLibrary.subscribe((state, prev) => {
    if (state.stations === prev.stations) return
    const result = diff(prev.stations, state.stations, end)
    end = result.end
    if (isEmpty(result.ops)) return
    bridge.library.write(result.ops).catch((err: unknown) => {
      console.error('[library] could not save', err)
    })
  })
}

function initBrowser(): void {
  useLibrary.setState({ stations: readLocal() ?? seedStations() })
  useLibrary.subscribe((state, prev) => {
    if (state.stations !== prev.stations) writeLocal(state.stations)
  })
}

/**
 * Load the saved library into the store and keep it saved from then on.
 * Must finish before the app renders, or it would first show an empty list.
 */
export async function initLibrary(): Promise<void> {
  if (desktop) {
    try {
      await initDesktop(desktop)
      return
    } catch (err) {
      // An unreadable database should not cost the listener their session;
      // localStorage still holds the library if it was never migrated.
      console.error('[library] SQLite unavailable, using localStorage', err)
    }
  }
  initBrowser()
}
