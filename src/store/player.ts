import { create } from 'zustand'
import { engine, type EngineStatus, type Pipeline } from '@/audio/engine'
import type { Capability, Station } from '@/types/station'
import { useLibrary } from './library'
import { registerClick } from '@/api/radioBrowser'
import { fetchNowPlaying, type NowPlaying, type NowPlayingSource } from '@/audio/nowPlaying'
import { clamp } from '@/lib/utils'

interface PlayerState {
  status: EngineStatus
  pipeline: Pipeline
  capability: Capability
  /** Measured loudness of the current stream, and the correction applied. */
  loudnessLufs: number | null
  levelGainDb: number
  message?: string
  /** The station the engine is loaded with; cleared by stop(). */
  currentId: string | null
  /**
   * The station the user last chose.
   *
   * Distinct from `currentId`, which follows the engine and goes null on stop.
   * Playback controls act on this, so pause/resume and play-after-stop return
   * to what you were listening to rather than to the top of the list.
   */
  selectedId: string | null
  /** Currently playing track, when the station exposes one. */
  nowPlaying: NowPlaying | null
  volume: number
  muted: boolean
  /** Ordered station ids as currently displayed, so next/prev follow the user's sort. */
  queue: string[]

  setQueue: (ids: string[]) => void
  select: (id: string) => void
  play: (station: Station) => Promise<void>
  toggle: (station: Station) => Promise<void>
  /** Play/pause the selected station; what the space bar and menu invoke. */
  togglePlayback: () => Promise<void>
  pause: () => void
  stop: () => void
  step: (delta: number) => Promise<void>
  setVolume: (v: number) => void
  toggleMute: () => void
}

const VOLUME_KEY = 'player.volume'
const SELECTED_KEY = 'player.selectedId'

function loadSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

function saveSelected(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(SELECTED_KEY)
    else localStorage.setItem(SELECTED_KEY, id)
  } catch {
    // Selection is a convenience; losing it is not worth surfacing.
  }
}

function loadVolume(): number {
  const raw = localStorage.getItem(VOLUME_KEY)
  const n = raw === null ? NaN : Number(raw)
  return Number.isFinite(n) ? clamp(n, 0, 1) : 0.8
}

/**
 * Drop keyboard focus from a station row.
 *
 * Transport shortcuts move the selection while focus stays on whichever row
 * control was last clicked. Space would then activate that stale button and
 * jump back to its station. Releasing focus lets the global shortcut act on the
 * selection instead. Scoped to rows, so focus on the player bar is untouched.
 */
function releaseRowFocus(): void {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLElement && active.closest('[role="row"]')) active.blur()
}

export const usePlayer = create<PlayerState>()((set, get) => {
  const initialVolume = loadVolume()
  engine.setVolume(initialVolume)

  return {
    status: 'idle',
    pipeline: null,
    capability: 'unknown',
    loudnessLufs: null,
    levelGainDb: 0,
    currentId: null,
    selectedId: loadSelected(),
    nowPlaying: null,
    volume: initialVolume,
    muted: false,
    queue: [],

    setQueue: (ids) => set({ queue: ids }),

    select: (id) => {
      saveSelected(id)
      set({ selectedId: id })
    },

    play: async (station) => {
      get().select(station.id)
      const lib = useLibrary.getState()
      lib.markPlayed(station.id)
      if (station.sourceUuid) registerClick(station.sourceUuid)

      // A cached verdict older than a day is worth re-checking: stations move
      // hosts and fix their headers.
      const cacheAge = Date.now() - (station.capabilityCheckedAt ?? 0)
      const cacheFresh = station.capability !== 'unknown' && cacheAge < 24 * 60 * 60 * 1000

      const outcome = await engine.play({
        stationId: station.id,
        url: station.url,
        knownCapability: cacheFresh ? station.capability : undefined,
        knownUrl: cacheFresh ? (station.resolvedUrl ?? station.url) : undefined,
        knownLufs: station.loudnessLufs,
      })
      useLibrary
        .getState()
        .recordCapability(station.id, outcome.capability, outcome.url, outcome.reason)
      updateMediaSession(station)
      // Track metadata rides on its own connection, so it works even for
      // stations that are barred from the Web Audio graph.
      startNowPlaying({ ...station, resolvedUrl: outcome.url })
    },

    toggle: async (station) => {
      const { currentId, status } = get()
      const live = status === 'playing' || status === 'buffering' || status === 'connecting'
      if (currentId === station.id && live) {
        get().pause()
        return
      }
      await get().play(station)
    },

    /**
     * Play/pause without naming a station.
     *
     * Falls back to the head of the queue only when nothing has ever been
     * selected — otherwise it resumes whatever the listener last chose, which
     * is the whole point of tracking a selection separately from playback.
     */
    togglePlayback: async () => {
      const { selectedId, queue } = get()
      const stations = useLibrary.getState().stations
      const station =
        stations.find((s) => s.id === selectedId) ??
        stations.find((s) => s.id === queue[0])
      if (!station) return
      await get().toggle(station)
    },

    pause: () => {
      stopNowPlaying()
      engine.pause()
    },

    stop: () => {
      stopNowPlaying()
      engine.stop()
    },

    step: async (delta) => {
      releaseRowFocus()
      const { queue, selectedId } = get()
      if (queue.length === 0) return
      // Step from the selection, not from the engine: after a pause or stop the
      // engine holds nothing, and next/previous should still move from where
      // the listener is rather than jumping to the top of the list.
      const idx = selectedId ? queue.indexOf(selectedId) : -1
      const nextIdx = idx < 0 ? 0 : (idx + delta + queue.length) % queue.length
      const nextId = queue[nextIdx]
      const station = useLibrary.getState().stations.find((s) => s.id === nextId)
      if (station) await get().play(station)
    },

    setVolume: (v) => {
      const vol = clamp(v, 0, 1)
      engine.setVolume(vol)
      localStorage.setItem(VOLUME_KEY, String(vol))
      set({ volume: vol, muted: vol === 0 ? get().muted : false })
    },

    toggleMute: () => {
      const muted = !get().muted
      engine.setMuted(muted)
      set({ muted })
    },
  }
})

/** How often to re-read the track while a station is playing. */
const NOW_PLAYING_INTERVAL = 25000
/** Which route worked for a station, so repeat polls cost one request, not four. */
const sourceCache = new Map<string, NowPlayingSource>()

let npTimer: number | null = null
let npAbort: AbortController | null = null

function stopNowPlaying(): void {
  if (npTimer !== null) {
    clearInterval(npTimer)
    npTimer = null
  }
  npAbort?.abort()
  npAbort = null
  usePlayer.setState({ nowPlaying: null })
}

function startNowPlaying(station: Station): void {
  stopNowPlaying()
  const url = station.resolvedUrl ?? station.url
  let preferred = sourceCache.get(station.id)
  let everHit = false
  let misses = 0

  const tick = async () => {
    // Nothing is on screen to update, and each poll costs bandwidth.
    if (document.hidden) return
    npAbort?.abort()
    npAbort = new AbortController()
    const hit = await fetchNowPlaying(url, preferred, npAbort.signal)
    // The listener may have moved on while the request was in flight.
    if (usePlayer.getState().currentId !== station.id) return

    if (hit) {
      everHit = true
      preferred = hit.source
      sourceCache.set(station.id, hit.source)
      usePlayer.setState({ nowPlaying: hit })
      updateMediaSession(station, hit)
      return
    }
    usePlayer.setState({ nowPlaying: null })
    misses++
    // A station that exposes nothing on the first couple of tries will not
    // start later, so stop rather than re-probing four endpoints forever.
    if (!everHit && misses >= 2) stopNowPlaying()
  }

  void tick()
  npTimer = window.setInterval(() => void tick(), NOW_PLAYING_INTERVAL)
}

/**
 * Persist each loudness reading against the station it came from.
 *
 * Throttled: the meter updates ten times a second, and writing the library that
 * often would thrash localStorage for no benefit.
 */
let lastLoudnessWrite = 0
engine.setLoudnessListener((lufs) => {
  const now = Date.now()
  if (now - lastLoudnessWrite < 5000) return
  const id = usePlayer.getState().currentId
  if (!id) return
  lastLoudnessWrite = now
  useLibrary.getState().recordLoudness(id, lufs)
})

// Mirror the engine's own state into the store; the engine is the source of
// truth for anything that happens asynchronously (buffering, drops, retries).
engine.subscribe((s) => {
  usePlayer.setState({
    status: s.status,
    pipeline: s.pipeline,
    capability: s.capability,
    loudnessLufs: s.loudnessLufs,
    levelGainDb: s.levelGainDb,
    message: s.message,
    currentId: s.stationId,
  })
  if (s.status === 'idle') stopNowPlaying()
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState =
      s.status === 'playing' ? 'playing' : s.status === 'idle' ? 'none' : 'paused'
  }
})

function updateMediaSession(station: Station, track?: NowPlaying): void {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track?.title ?? station.name,
    artist: track?.artist ?? (track ? station.name : station.country ?? 'Online radio'),
    album: station.name,
    artwork: station.favicon ? [{ src: station.favicon, sizes: '256x256' }] : [],
  })
}

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => {
    const { currentId } = usePlayer.getState()
    const station = useLibrary.getState().stations.find((s) => s.id === currentId)
    if (station) void usePlayer.getState().play(station)
  })
  navigator.mediaSession.setActionHandler('pause', () => usePlayer.getState().stop())
  navigator.mediaSession.setActionHandler('stop', () => usePlayer.getState().stop())
  navigator.mediaSession.setActionHandler('nexttrack', () => void usePlayer.getState().step(1))
  navigator.mediaSession.setActionHandler('previoustrack', () => void usePlayer.getState().step(-1))
}
