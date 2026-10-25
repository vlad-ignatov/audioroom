import { create } from 'zustand'
import { desktop, type LooseFileEntry } from '@/lib/desktop'
import { indexFiles } from './localLibrary'
import { usePlayer } from './player'

/**
 * The most tracks the queue holds.
 *
 * A drop is walked only until the queue is full, so dropping the root of a
 * collection costs a few directory reads rather than a scan of every file
 * under it. The list itself would cope with more (rows and their tags are
 * only read when on screen); the limit is there to keep one careless drop
 * cheap.
 */
export const QUEUE_LIMIT = 1000

interface PlayQueueState {
  tracks: LooseFileEntry[]
  /** Read the saved queue; call once at startup. */
  load: () => Promise<void>
  /**
   * Add files, and folders walked recursively, before `index` (the end by
   * default). Tracks already queued are skipped. Resolves to a message for the
   * user when something was left out, or null.
   */
  add: (paths: string[], index?: number) => Promise<string | null>
  /** Move the track at `from` so it lands before what is now at `to`. */
  move: (from: number, to: number) => void
  remove: (path: string) => void
  /** Random order; the track with this URL, if queued, goes first. */
  shuffle: (firstUrl?: string | null) => void
  clear: () => void
  /** Look again for tracks that were missing; their drive or share may be back. */
  recheck: () => Promise<void>
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * Save the queue, and keep the player's next/previous in step with it while
 * playback is following it.
 */
function commit(tracks: LooseFileEntry[]): void {
  void desktop?.queue.set(tracks.map((t) => t.path))
  const player = usePlayer.getState()
  if (player.queueSource === 'queue') player.setQueue(tracks.map((t) => t.url), 'queue')
}

export const usePlayQueue = create<PlayQueueState>()((set, get) => ({
  tracks: [],

  load: async () => {
    if (!desktop) return
    // Missing files stay: a drive that is not mounted right now should not
    // cost the queue its tracks.
    const tracks = await desktop.fileEntries(await desktop.queue.list(), true)
    indexFiles(tracks.filter((t) => !t.missing))
    set({ tracks })
    const player = usePlayer.getState()
    if (player.queueSource === 'queue') player.setQueue(tracks.map((t) => t.url), 'queue')
  },

  add: async (paths, index) => {
    if (!desktop || paths.length === 0) return null
    const current = get().tracks
    const room = QUEUE_LIMIT - current.length
    if (room <= 0) return `The queue is full (${QUEUE_LIMIT} tracks).`
    const queued = current.map((t) => t.path)
    const found = await desktop.collectAudio(paths, room, queued)
    const entries = await desktop.fileEntries(found.paths)
    if (entries.length === 0) {
      return found.truncated ? null : 'No audio files to add, or they are already in the queue.'
    }
    indexFiles(entries)
    // The queue may have changed while the drop was being walked.
    const latest = get().tracks
    const have = new Set(latest.map((t) => t.path))
    const fresh = entries.filter((e) => !have.has(e.path)).slice(0, QUEUE_LIMIT - latest.length)
    const at = Math.max(0, Math.min(index ?? latest.length, latest.length))
    const tracks = [...latest.slice(0, at), ...fresh, ...latest.slice(at)]
    set({ tracks })
    commit(tracks)
    return found.truncated
      ? `Added ${plural(fresh.length, 'track')}; the queue holds at most ${QUEUE_LIMIT}.`
      : null
  },

  move: (from, to) => {
    const tracks = [...get().tracks]
    if (from < 0 || from >= tracks.length) return
    const [track] = tracks.splice(from, 1)
    // Removing it shifted everything after it up by one.
    const at = Math.max(0, Math.min(from < to ? to - 1 : to, tracks.length))
    if (at === from) return
    tracks.splice(at, 0, track!)
    set({ tracks })
    commit(tracks)
  },

  remove: (path) => {
    const tracks = get().tracks.filter((t) => t.path !== path)
    set({ tracks })
    commit(tracks)
  },

  shuffle: (firstUrl) => {
    const tracks = [...get().tracks]
    // Fisher–Yates.
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[tracks[i], tracks[j]] = [tracks[j]!, tracks[i]!]
    }
    const first = firstUrl ? tracks.findIndex((t) => t.url === firstUrl) : -1
    if (first > 0) tracks.unshift(...tracks.splice(first, 1))
    set({ tracks })
    commit(tracks)
  },

  clear: () => {
    set({ tracks: [] })
    commit([])
  },

  recheck: async () => {
    const missing = get().tracks.filter((t) => t.missing).map((t) => t.path)
    if (!desktop || missing.length === 0) return
    const found = (await desktop.fileEntries(missing)).filter((t) => !t.missing)
    if (found.length === 0) return
    indexFiles(found)
    const byPath = new Map(found.map((t) => [t.path, t]))
    // Only the flag changes; nothing to save.
    set((st) => ({ tracks: st.tracks.map((t) => byPath.get(t.path) ?? t) }))
  },
}))
