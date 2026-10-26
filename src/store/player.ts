import { create } from 'zustand'
import { engine, type EngineStatus, type Pipeline } from '@/audio/engine'
import type { Capability, Station } from '@/types/station'
import { useLibrary } from './library'
import { registerClick } from '@/api/radioBrowser'
import { fetchNowPlaying, type NowPlaying, type NowPlayingSource } from '@/audio/nowPlaying'
import { clamp } from '@/lib/utils'
import { isLocalFile } from '@/lib/desktop'
import { findPlayable } from '@/lib/playable'
import { settings } from '@/lib/settings'

interface PlayerState {
  status: EngineStatus
  pipeline: Pipeline
  capability: Capability
  /** True while a local file is loaded: it has a position and can be seeked. */
  seekable: boolean
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
  /**
   * Ordered ids of the list playback started from, as currently displayed, so
   * next/prev follow the user's sort and stay in that list across tab switches.
   */
  queue: string[]
  /**
   * Which list `queue` came from. Lists keep the queue in step with what they
   * show only while they own it, so a track that is both in the play queue
   * and on screen in the tree is not pulled from one list into the other.
   */
  queueSource: QueueSource | null

  setQueue: (ids: string[], source: QueueSource) => void
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
  /** Jump to a position in the current local file. No effect on a stream. */
  seek: (seconds: number) => void
}

export type QueueSource = 'stations' | 'tree' | 'queue'

const VOLUME_KEY = 'player.volume'
const SELECTED_KEY = 'player.selectedId'
const SOURCE_KEY = 'player.queueSource'

function loadSource(): QueueSource | null {
  const raw = settings.getItem(SOURCE_KEY)
  return raw === 'stations' || raw === 'tree' || raw === 'queue' ? raw : null
}

function loadSelected(): string | null {
  return settings.getItem(SELECTED_KEY)
}

function saveSelected(id: string | null): void {
  if (id === null) settings.removeItem(SELECTED_KEY)
  else settings.setItem(SELECTED_KEY, id)
}

function loadVolume(): number {
  const raw = settings.getItem(VOLUME_KEY)
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
    seekable: false,
    loudnessLufs: null,
    levelGainDb: 0,
    currentId: null,
    selectedId: loadSelected(),
    nowPlaying: null,
    volume: initialVolume,
    muted: false,
    queue: [],
    queueSource: loadSource(),

    setQueue: (ids, source) => {
      if (source !== get().queueSource) settings.setItem(SOURCE_KEY, source)
      set({ queue: ids, queueSource: source })
    },

    select: (id) => {
      saveSelected(id)
      set({ selectedId: id })
    },

    play: async (station) => {
      // Whatever was playing, its track info is stale now. A new stream starts
      // its own poll below, but a local file has none, and without this the
      // last station's "artist — title" stayed on screen over the file.
      stopNowPlaying()
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
      // A stream's verdict is worth remembering for a day; a file's is not. It
      // was known to be playable when it was added, and a failure now is more
      // likely an unmounted drive than a file that has stopped being audio.
      if (!isLocalFile(station.url)) {
        useLibrary
          .getState()
          .recordCapability(station.id, outcome.capability, outcome.url, outcome.reason)
      }
      updateMediaSession(station)
      // Measure the next track while this one plays, so it starts levelled
      // without a wait.
      if (isLocalFile(station.url)) {
        const { queue } = get()
        const next = findPlayable(queue[queue.indexOf(station.id) + 1])
        if (next) engine.prepareLevel(next.url)
      }
      // Track metadata rides on its own connection, so it works even for
      // stations that are barred from the Web Audio graph. A local file has
      // no such thing; its tags were read when it was added.
      if (!isLocalFile(station.url)) startNowPlaying({ ...station, resolvedUrl: outcome.url })
    },

    toggle: async (station) => {
      const { currentId, status } = get()
      const live = status === 'playing' || status === 'buffering' || status === 'connecting'
      if (currentId === station.id && live) {
        get().pause()
        return
      }
      // A paused file continues from where it stopped; a paused stream has
      // been disconnected and is played afresh, which resume() declines.
      if (currentId === station.id && status === 'paused' && (await engine.resume())) return
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
      const station = findPlayable(selectedId) ?? findPlayable(queue[0])
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
      const station = findPlayable(nextId)
      if (station) await get().play(station)
    },

    setVolume: (v) => {
      const vol = clamp(v, 0, 1)
      engine.setVolume(vol)
      settings.setItem(VOLUME_KEY, String(vol))
      set({ volume: vol, muted: vol === 0 ? get().muted : false })
    },

    toggleMute: () => {
      const muted = !get().muted
      engine.setMuted(muted)
      set({ muted })
    },

    seek: (seconds) => engine.seek(seconds),
  }
})

/**
 * When a local file plays through, move on to the next row.
 *
 * Follows the queue in display order, as next/previous do, and stops at the
 * end of it rather than wrapping: a list that loops forever is a surprise, a
 * list that finishes is what every music player does.
 */
engine.setEndedListener(() => {
  const { queue, currentId } = usePlayer.getState()
  const idx = currentId ? queue.indexOf(currentId) : -1
  const nextId = idx >= 0 ? queue[idx + 1] : undefined
  const station = findPlayable(nextId)
  if (station) void usePlayer.getState().play(station)
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
      // No re-levelling on a track change, deliberately. It was tried: a few
      // seconds of one song measure several dB apart depending on whether
      // they catch a verse or a chorus, the title changes up to a poll late
      // and rarely in step with the audio, and the result was the volume
      // lurching mid-song. Stations already level their own programme; the
      // gap worth closing is between stations, measured once at the start.
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
 * often would thrash the database for no benefit.
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
    seekable: s.seekable,
    loudnessLufs: s.loudnessLufs,
    levelGainDb: s.levelGainDb,
    message: s.message,
    currentId: s.stationId,
  })
  if (s.status === 'idle') stopNowPlaying()
  if ('mediaSession' in navigator) {
    // Connecting and buffering count as playing: that is the listener's
    // intent, and it makes the system's play/pause toggle send "pause".
    navigator.mediaSession.playbackState =
      s.status === 'idle' ? 'none' : isLive(s.status) ? 'playing' : 'paused'
  }
})

function updateMediaSession(station: Station, track?: NowPlaying): void {
  if (!('mediaSession' in navigator)) return
  const local = isLocalFile(station.url)
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track?.title ?? station.name,
    artist: track?.artist ?? (track ? station.name : station.country ?? (local ? 'Local file' : 'Online radio')),
    album: local ? (station.album ?? '') : station.name,
    artwork: station.favicon ? [{ src: station.favicon, sizes: '256x256' }] : [],
  })
}

function isLive(status: PlayerState['status']): boolean {
  return status === 'playing' || status === 'buffering' || status === 'connecting'
}

/**
 * The system's transport: Control Center, keyboard media keys, and headphone
 * controls and wear sensors all arrive here on macOS, routed to whichever app
 * the OS considers Now Playing.
 *
 * "pause" must really pause: stopping releases the player, the OS then hands
 * Now Playing to another app, and the next "play" (putting the headphones
 * back on) starts that app instead. "play" and "pause" are also idempotent,
 * unlike the in-app toggle, since the OS may send either in any state.
 */
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => {
    const player = usePlayer.getState()
    // togglePlayback() rather than play(): a paused file should continue, not
    // restart, and after a stop there is only the selection to go on.
    if (!isLive(player.status)) void player.togglePlayback()
  })
  navigator.mediaSession.setActionHandler('pause', () => {
    const player = usePlayer.getState()
    if (isLive(player.status)) player.pause()
  })
  navigator.mediaSession.setActionHandler('stop', () => usePlayer.getState().stop())
  navigator.mediaSession.setActionHandler('nexttrack', () => void usePlayer.getState().step(1))
  navigator.mediaSession.setActionHandler('previoustrack', () => void usePlayer.getState().step(-1))
}
