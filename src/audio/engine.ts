import type Hls from 'hls.js'
import { BAND_Q, BAND_COUNT, EQ_FREQUENCIES, dbToGain, eqHeadroomDb, filterTypeForBand } from './eq'
import { probeStream } from './probe'
import { DEFAULT_REVERB, renderImpulseResponse, type ImpulseOptions } from './fx'
import {
  createLoudnessTap,
  correctionDb,
  LoudnessMeter,
  DEFAULT_TARGET_LUFS,
  SAMPLE_INTERVAL_MS,
  measureStreamLoudness,
} from './loudness'
import type { Capability } from '@/types/station'
import { isDesktop, isLocalFile, playableUrl } from '@/lib/desktop'

export type EngineStatus =
  | 'idle'
  | 'connecting'
  | 'buffering'
  | 'playing'
  /** Stream released, but the station is still the one loaded. */
  | 'paused'
  | 'error'

/** Which of the two audio elements is currently carrying sound. */
export type Pipeline = 'graph' | 'plain' | null

export interface EngineState {
  status: EngineStatus
  pipeline: Pipeline
  stationId: string | null
  capability: Capability
  /**
   * True while a local file is loaded. A file has a position and a length,
   * pauses in place, and can be seeked; a live stream has none of that.
   */
  seekable: boolean
  /** User-facing explanation for a degraded or failed station. */
  message?: string
  /** Most recent gated loudness of the stream, LUFS. */
  loudnessLufs: number | null
  /** Correction currently applied, dB. */
  levelGainDb: number
}

export interface PlayRequest {
  stationId: string
  url: string
  /** Skip the network probe when we already know the answer. */
  knownCapability?: Capability
  knownUrl?: string
  /** Loudness measured on a previous play, so levelling starts correct. */
  knownLufs?: number
}

export interface PlayOutcome {
  capability: Capability
  url: string
  reason?: string
}

/** Where a local file is, in seconds. `duration` is null until known. */
export interface Timing {
  position: number
  duration: number | null
}

const MAX_RETRIES = 3

/** A bypassable link in the processing chain, addressed only by its endpoints. */
interface Stage {
  input: AudioNode
  output: AudioNode
}

/**
 * Owns every piece of audio state in the app.
 *
 * The central constraint: `createMediaElementSource()` binds an element to the
 * audio graph *permanently* and cannot be undone, and a CORS-tainted element
 * routed through a graph outputs silence rather than raising an error. So we
 * keep two elements for the lifetime of the page — `graphEl`, which is bound,
 * and `plainEl`, which is never passed to the Web Audio API at all — and route
 * each station to whichever one its server permits.
 */
/**
 * Put a media element in the document.
 *
 * WebKit only routes an element's audio into a Web Audio graph while the
 * element is in the document; a detached one plays through the ordinary media
 * path and `createMediaElementSource()` receives silence — so every filter,
 * the reverb, the width matrix and the analyser process nothing while the
 * station is plainly audible. Other engines route detached elements fine.
 *
 * An <audio> without `controls` renders nothing, so this is invisible.
 */
const LIVE_GRAPH_KEY = 'audio.liveStreamGraphOk'

/**
 * How long to wait for a measurement before starting unlevelled.
 *
 * Generous, because this runs alongside connecting rather than before it: the
 * stream itself usually takes longer, so the measurement is free. It only
 * becomes a delay for a station that connects fast and measures slowly.
 */
const PREROLL_TIMEOUT_MS = 6000

/**
 * How much live audio to measure when the silent pre-roll could not, or when
 * the track changes mid-stream. Long enough for the gating to see past an
 * intro; short enough that a wrong level is not endured for long.
 */
const LIVE_WINDOW_S = 6

/** Fade-in when the correction lands: long enough to avoid a click. */
const LEVEL_FADE_S = 0.08

const NO_LIVE_GRAPH =
  'This browser will not route live streams through Web Audio. Equalizer, effects and visualizer unavailable.'

function readVerdict(): boolean | null {
  try {
    const v = localStorage.getItem(LIVE_GRAPH_KEY)
    return v === null ? null : v === 'true'
  } catch {
    return null
  }
}

function writeVerdict(ok: boolean): void {
  try {
    localStorage.setItem(LIVE_GRAPH_KEY, String(ok))
  } catch {
    // Private browsing; we simply re-measure next session.
  }
}

function attachToDocument(el: HTMLAudioElement): void {
  if (typeof document === 'undefined') return
  // Deliberately not `hidden`/display:none: the element must stay in the
  // document, and there is no need to risk WebKit's check being render-aware.
  const add = () => document.body?.appendChild(el)
  if (document.body) add()
  else document.addEventListener('DOMContentLoaded', add, { once: true })
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private readonly graphEl: HTMLAudioElement
  private readonly plainEl: HTMLAudioElement
  private source: MediaElementAudioSourceNode | null = null
  private preamp: GainNode | null = null
  private output: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private filters: BiquadFilterNode[] = []

  private hls: Hls | null = null
  private active: HTMLAudioElement | null = null
  private listeners = new Set<(s: EngineState) => void>()
  private retries = 0
  private retryTimer: number | null = null
  /**
   * Identifies the current attachment. Clearing an element's source fires a
   * delayed `error` event, which would otherwise be misattributed to whatever
   * station is loaded next and abort its play() call. Every element event is
   * checked against this token so stale ones are dropped.
   */
  private streamToken = 0
  /** True while an el.play() promise is in flight; a retry must not abort it. */
  private pendingPlay = false
  /**
   * Whether the loaded source is a local file rather than a live stream.
   *
   * Decides pause semantics (hold the position vs. drop the connection), what
   * `ended` means (the track is over vs. the stream broke) and whether an error
   * is worth a reconnect.
   */
  private isFile = false
  private timeListeners = new Set<(t: Timing) => void>()
  private onEnded: (() => void) | null = null
  /** Fires if a station never reaches 'playing' within a reasonable time. */
  private watchdog: number | null = null
  /** Guards against a slow probe for station A landing after the user picked B. */
  private generation = 0
  /**
   * Whether this browser routes an unbounded live stream into the graph.
   * null until measured.
   *
   * WebKit does not, and reports no error: the element stays audible while the
   * graph receives silence. Measured, not sniffed — the same engine routes a
   * finite file of identical codec and origin perfectly well, so nothing about
   * the URL predicts this and only the analyser can answer it.
   */
  private liveStreamGraphOk: boolean | null = readVerdict()
  private detectTimer: number | null = null

  private state: EngineState = {
    status: 'idle',
    pipeline: null,
    stationId: null,
    capability: 'unknown',
    seekable: false,
    loudnessLufs: null,
    levelGainDb: 0,
  }

  private volume = 0.8
  private muted = false
  private gains: number[] = new Array(BAND_COUNT).fill(0)
  private preampDb = 0

  // ---- processing stages, each independently bypassable ----
  private eqStage: Stage | null = null
  private reverbStage: Stage | null = null
  private widthStage: Stage | null = null
  private convolver: ConvolverNode | null = null
  private preDelayNode: DelayNode | null = null
  private dryGain: GainNode | null = null
  private wetGain: GainNode | null = null
  private sideBus: GainNode | null = null

  // ---- loudness levelling ----
  /** Applies the correction; sits before the EQ so stages see a steady level. */
  private levelGain: GainNode | null = null
  /** Catches peaks created by boosting a quiet station. */
  private limiter: DynamicsCompressorNode | null = null
  private meter: LoudnessMeter | null = null
  /**
   * The loudness the current correction was computed from. Levelling is
   * measure-once: a station or track is inspected when it starts and the
   * result holds until something changes, so the listener never hears the
   * volume wander with the music. Kept so a change of target can be applied
   * without measuring again.
   */
  private measuredLufs: number | null = null
  /**
   * Analyser fed straight from the source, before the volume gain.
   *
   * Anything that needs to know whether audio is *arriving* must read here:
   * `this.analyser` sits after the output gain, so it reads silence whenever
   * the user is muted or at zero volume.
   */
  private sourceAnalyser: AnalyserNode | null = null
  private meterTimer: number | null = null
  private levelingEnabled = true
  private levelingTarget = DEFAULT_TARGET_LUFS
  /** Loudness remembered from a previous play, used only if measuring fails. */
  private seedLufs: number | null = null
  private onLoudness: ((lufs: number, gainDb: number) => void) | null = null

  private eqEnabled = true
  private reverbEnabled = false
  private widthEnabled = false

  private reverbOpts: ImpulseOptions = {
    seconds: DEFAULT_REVERB.seconds,
    decay: DEFAULT_REVERB.decay,
    damping: DEFAULT_REVERB.damping,
    early: DEFAULT_REVERB.early,
  }
  private reverbMix = DEFAULT_REVERB.mix
  private preDelayMs = DEFAULT_REVERB.preDelayMs
  private width = 1

  constructor() {
    this.graphEl = this.makeElement()
    this.graphEl.crossOrigin = 'anonymous'
    this.plainEl = this.makeElement()
    attachToDocument(this.graphEl)
    attachToDocument(this.plainEl)
  }

  private makeElement(): HTMLAudioElement {
    const el = new Audio()
    el.preload = 'none'
    el.autoplay = false
    const current = () => el === this.active && el.dataset.token === String(this.streamToken)
    el.addEventListener('playing', () => {
      if (!current()) return
      this.retries = 0
      this.clearWatchdog()
      this.patch({ status: 'playing' })
    })
    // A paused stream is still attached (see pause()), and its connection may
    // stall or be dropped by the server while nobody is listening. None of
    // that is news: resuming reconnects anyway.
    const held = () => this.state.status === 'paused'
    el.addEventListener('waiting', () => {
      if (current() && !held()) this.patch({ status: 'buffering' })
    })
    // 'stalled' means no data has arrived for a few seconds. For a live radio
    // stream that is normal while connecting, not a failure — reloading here
    // aborts the in-flight play() and kills a connection that was about to
    // succeed. Report it, but let the watchdog decide if it is actually stuck.
    el.addEventListener('stalled', () => {
      if (current() && !held()) this.patch({ status: 'buffering' })
    })
    el.addEventListener('error', () => {
      if (!current() || this.pendingPlay || held()) return
      // While play() is pending its rejection carries the real reason, and
      // reloading now would be the thing that rejects it.
      if (this.isFile) {
        // A file that failed once will fail again; there is no connection to
        // re-establish.
        this.patch({ status: 'error', message: describeFileError(el.error) })
        return
      }
      this.scheduleRetry(describeMediaError(el.error))
    })
    el.addEventListener('ended', () => {
      if (!current() || this.pendingPlay || held()) return
      if (this.isFile) {
        this.finishFile()
        return
      }
      this.scheduleRetry('Stream ended unexpectedly.')
    })
    // Position reporting, only meaningful for files. A live stream's
    // currentTime counts up too, but the number tells the listener nothing.
    const report = () => {
      if (current() && this.isFile) this.emitTiming(el)
    }
    for (const type of ['timeupdate', 'durationchange', 'loadedmetadata', 'seeking', 'seeked']) {
      el.addEventListener(type, report)
    }
    return el
  }

  private emitTiming(el: HTMLAudioElement | null): void {
    const timing: Timing =
      el && this.isFile
        ? {
            position: el.currentTime,
            duration: Number.isFinite(el.duration) ? el.duration : null,
          }
        : { position: 0, duration: null }
    for (const fn of this.timeListeners) fn(timing)
  }

  /**
   * A local file reached its end.
   *
   * Left on the station, rewound and paused, so pressing play repeats it;
   * the owner is told so it can decide to move on to the next track.
   */
  private finishFile(): void {
    this.stopMetering()
    const el = this.active
    if (el) {
      el.pause()
      el.currentTime = 0
    }
    this.patch({ status: 'paused', message: undefined })
    this.emitTiming(el)
    this.onEnded?.()
  }

  // ---------------------------------------------------------------- graph ---

  /**
   * Build the Web Audio graph.
   *
   * Called synchronously from `play()` so construction happens inside the
   * gesture that asked for playback. That costs a context for users who only
   * ever play restricted stations, which the previous lazy placement avoided —
   * but the placement could not survive the awaited capability probe, and a
   * graph Safari refuses to run is worse than a graph nobody uses. Binding
   * `graphEl` early is free: it is never handed a playback-only stream.
   */
  private ensureGraph(): void {
    if (this.ctx) return
    const ctx = new AudioContext()
    this.ctx = ctx

    this.source = ctx.createMediaElementSource(this.graphEl)

    this.preamp = ctx.createGain()
    this.preamp.gain.value = dbToGain(this.preGainDb())

    this.filters = EQ_FREQUENCIES.map((hz, i) => {
      const f = ctx.createBiquadFilter()
      f.type = filterTypeForBand(i)
      f.frequency.value = hz
      f.Q.value = BAND_Q
      f.gain.value = this.gains[i] ?? 0
      return f
    })

    // The filter bank is one stage among several; chain it internally and
    // expose only its endpoints.
    for (let i = 0; i < this.filters.length - 1; i++) {
      this.filters[i]!.connect(this.filters[i + 1]!)
    }
    this.eqStage = { input: this.filters[0]!, output: this.filters[this.filters.length - 1]! }

    this.reverbStage = this.buildReverbStage(ctx)
    this.widthStage = this.buildWidthStage(ctx)

    // Levelling sits between the source and everything else: the EQ and the
    // effects then always see a comparable input level, and the user's volume
    // control downstream stays the final word.
    this.levelGain = ctx.createGain()
    this.levelGain.gain.value = 1

    // A safety net against clipping, not a sound-shaping stage. It is a
    // full-band compressor: whenever it acts, a bass hit turns *everything*
    // down, heard as vocals ducking on each kick. So the threshold sits at full
    // scale, where commercial masters already peak and where nothing short of
    // a genuine over reaches it. At 0 dB the node's automatic makeup gain is
    // also exactly 0 dB; any lower threshold adds makeup gain that makes the
    // whole signal hotter and the limiter act even more often. EQ boosts get
    // their headroom from the pre-gain instead (see preGainDb).
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = 0
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.001
    this.limiter.release.value = 0.1

    // Measure the station as broadcast, upstream of our own correction, so the
    // reading does not chase the gain we just applied.
    const tap = createLoudnessTap(ctx)
    this.source.connect(tap.input)
    this.meter = new LoudnessMeter(tap.analyser)
    this.sourceAnalyser = tap.analyser

    this.output = ctx.createGain()
    this.output.gain.value = this.muted ? 0 : this.volume

    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.8

    this.source.connect(this.levelGain)
    this.levelGain.connect(this.preamp)
    this.output.connect(this.analyser)
    this.analyser.connect(ctx.destination)

    // Push every parameter that was set before the context existed.
    this.setReverbImpulse(this.reverbOpts)
    this.setReverbMix(this.reverbMix)
    this.setPreDelay(this.preDelayMs)
    this.setWidth(this.width)
    this.rebuildChain()
  }

  /** Convolution reverb as a parallel dry/wet send. */
  private buildReverbStage(ctx: AudioContext): Stage {
    const input = ctx.createGain()
    const out = ctx.createGain()
    const dry = ctx.createGain()
    const wet = ctx.createGain()
    const preDelay = ctx.createDelay(0.5)
    const convolver = ctx.createConvolver()
    convolver.normalize = true

    input.connect(dry).connect(out)
    input.connect(preDelay).connect(convolver).connect(wet).connect(out)

    this.dryGain = dry
    this.wetGain = wet
    this.preDelayNode = preDelay
    this.convolver = convolver
    return { input, output: out }
  }

  /**
   * Mid-side width control.
   *
   *   mid = (L+R)/2,  side = (L-R)/2,  out = mid ± side * width
   *
   * At width 1 this is a bit-exact passthrough, at 0 it collapses to mono, and
   * above 1 it exaggerates the stereo difference. The input is forced to two
   * channels so a mono stream upmixes rather than landing entirely in the left
   * speaker.
   */
  private buildWidthStage(ctx: AudioContext): Stage {
    const input = ctx.createGain()
    input.channelCount = 2
    input.channelCountMode = 'explicit'
    input.channelInterpretation = 'speakers'

    const splitter = ctx.createChannelSplitter(2)
    const merger = ctx.createChannelMerger(2)
    const mid = ctx.createGain()
    const sideL = ctx.createGain()
    const sideR = ctx.createGain()
    const sideBus = ctx.createGain()
    const sideInv = ctx.createGain()

    mid.gain.value = 0.5
    sideL.gain.value = 0.5
    sideR.gain.value = -0.5
    sideBus.gain.value = this.width
    sideInv.gain.value = -1

    input.connect(splitter)
    splitter.connect(mid, 0)
    splitter.connect(mid, 1)
    splitter.connect(sideL, 0)
    splitter.connect(sideR, 1)
    sideL.connect(sideBus)
    sideR.connect(sideBus)

    mid.connect(merger, 0, 0)
    mid.connect(merger, 0, 1)
    sideBus.connect(merger, 0, 0)
    sideBus.connect(sideInv).connect(merger, 0, 1)

    this.sideBus = sideBus
    return { input, output: merger }
  }

  /**
   * Reconnect preamp -> [enabled stages in order] -> output.
   *
   * Every inter-stage link originates at the preamp or at a stage output, so
   * disconnecting exactly those leaves each stage's internal wiring intact and
   * makes bypassing a stage a matter of leaving it out of the list.
   */
  private rebuildChain(): void {
    if (!this.ctx || !this.preamp || !this.output) return
    const all = [this.eqStage, this.reverbStage, this.widthStage]
    this.preamp.disconnect()
    for (const stage of all) stage?.output.disconnect()

    const active = [
      this.eqEnabled ? this.eqStage : null,
      this.reverbEnabled ? this.reverbStage : null,
      this.widthEnabled ? this.widthStage : null,
    ].filter((s): s is Stage => s !== null)

    let node: AudioNode = this.preamp
    for (const stage of active) {
      node.connect(stage.input)
      node = stage.output
    }
    if (this.limiter) {
      this.limiter.disconnect()
      node.connect(this.limiter)
      node = this.limiter
    }
    node.connect(this.output)
  }

  getAnalyser(): AnalyserNode | null {
    return this.state.pipeline === 'graph' ? this.analyser : null
  }

  // -------------------------------------------------------------- playback ---

  async play(req: PlayRequest): Promise<PlayOutcome> {
    const gen = ++this.generation
    this.teardownStream()
    this.isFile = isLocalFile(req.url)

    // Safari grants the right to create and start an AudioContext only for the
    // duration of the gesture that triggered this call, and it does not mute an
    // element whose context never started — so a graph built after the awaited
    // probe below plays unprocessed audio while every control still looks live.
    // Build and unlock it here, while the gesture is still ours.
    try {
      this.ensureGraph()
      void this.ctx?.resume().catch(() => {})
    } catch (err) {
      // Plain playback still works, but never swallow the reason: a graph that
      // throws part-way leaves `ctx` set and its nodes null, and every later
      // ensureGraph() call short-circuits on that half-built state.
      console.error('[audio] graph construction failed', err)
    }

    this.patch({
      status: 'connecting',
      stationId: req.stationId,
      capability: 'unknown',
      seekable: this.isFile,
      loudnessLufs: null,
      message: undefined,
      pipeline: null,
    })

    let outcome: PlayOutcome
    if (req.knownCapability && req.knownCapability !== 'unknown' && req.knownUrl) {
      outcome = { capability: req.knownCapability, url: req.knownUrl }
    } else {
      const probe = await probeStream(req.url)
      outcome = { capability: probe.capability, url: probe.url, reason: probe.reason }
    }
    if (gen !== this.generation) return outcome

    if (outcome.capability === 'unavailable') {
      this.patch({ status: 'error', message: outcome.reason ?? 'Station unavailable.' })
      return outcome
    }

    // A file that has been moved or deleted fails inside the media pipeline
    // with the same error as one that will not decode. Ask first, so the
    // listener is told which it is.
    if (this.isFile && !(await fileExists(outcome.url))) {
      if (gen !== this.generation) return outcome
      const reason = 'File not found. Was it moved or deleted?'
      this.patch({ status: 'error', message: reason })
      return { capability: 'unavailable', url: outcome.url, reason }
    }

    // 'unknown' means the probe timed out rather than being refused; give the
    // full pipeline a chance instead of pre-emptively degrading.
    let useGraph = outcome.capability === 'full' || outcome.capability === 'unknown'

    // The CORS probe answers a question that does not predict anything here:
    // this engine starves the graph for every live stream regardless of what
    // the headers say. Once measured, the verdict holds for all of them.
    if (useGraph && this.liveStreamGraphOk === false) {
      useGraph = false
      outcome = { ...outcome, capability: 'playback-only', reason: NO_LIVE_GRAPH }
    }
    // Begin measuring now, in parallel with connecting. The graph is silenced
    // until the answer arrives, so nothing is ever heard at the wrong level —
    // which is what made switching to a loud station jarring.
    const pendingLevel = useGraph ? this.beginLevel(outcome.url) : null
    this.seedLufs = req.knownLufs ?? null

    try {
      // attach() may downgrade a graph request it cannot honour, so its verdict
      // is the one the UI must see.
      const pipeline = await this.attach(outcome.url, useGraph)
      if (gen !== this.generation) return outcome
      if (pipeline === 'plain' && useGraph) {
        // Cache the downgrade, or the next play re-requests a graph it cannot have.
        outcome = {
          capability: 'playback-only',
          url: outcome.url,
          reason: 'This browser plays HLS natively, which bars Web Audio. Equalizer and visualizer unavailable.',
        }
      }
      this.patch({
        pipeline,
        capability: outcome.capability,
        message: outcome.reason,
      })
      if (pipeline === 'graph' && pendingLevel) {
        const measured = await this.settleLevel(pendingLevel, gen)
        // No silent measurement (a codec the decoder will not take piecemeal,
        // an HLS playlist): take one window of what is playing instead.
        if (!measured) this.measureLive(gen)
      }
      // Chromium routes live streams correctly; the check exists for WebKit,
      // which the desktop build never runs on.
      if (!isDesktop && pipeline === 'graph' && this.liveStreamGraphOk === null) {
        this.detectGraphRouting(gen, req)
      }
    } catch (err) {
      if (gen !== this.generation) return outcome
      const message = err instanceof Error ? err.message : 'Playback failed.'
      this.patch({ status: 'error', message })

      // The probe cannot tell a CORS refusal from a host that is simply gone —
      // fetch reports both as an opaque failure. Playback is the tiebreaker: if
      // the element could not start either, the station is genuinely
      // unreachable and should be recorded as such rather than cached as the
      // friendlier 'playback-only'.
      const blockedByAutoplay = err instanceof DOMException && err.name === 'NotAllowedError'
      if (blockedByAutoplay) {
        return { ...outcome, reason: 'Your browser blocked autoplay. Press play again to start.' }
      }
      if (this.isFile) {
        // Not a reachability question: the file is there, it just will not
        // decode. Say so, and leave the capability alone.
        const reason = describeFileError(this.active?.error ?? null)
        this.patch({ message: reason })
        return { capability: 'unavailable', url: outcome.url, reason }
      }
      this.patch({ capability: 'unavailable' })
      return { capability: 'unavailable', url: outcome.url, reason: message }
    }
    return outcome
  }

  private async attach(url: string, requestGraph: boolean): Promise<Exclude<Pipeline, null>> {
    // The probe classifies HLS from a feature check; hls.js is the authority on
    // whether it will actually take the stream. If it stands down, the element
    // fetches the playlist itself and would taint a graph it can never leave,
    // so settle the question before picking an element.
    let useGraph = requestGraph
    if (useGraph && /\.m3u8(\?|$)/i.test(url)) {
      const { default: Hls } = await import('hls.js')
      if (!Hls.isSupported()) useGraph = false
    }

    const el = useGraph ? this.graphEl : this.plainEl
    if (useGraph) {
      this.ensureGraph()
      if (this.ctx?.state === 'suspended') await this.ctx.resume()
    }
    this.active = el
    el.dataset.token = String(this.streamToken)
    this.applyVolume()
    this.patch({ pipeline: useGraph ? 'graph' : 'plain' })

    if (/\.m3u8(\?|$)/i.test(url)) {
      await this.attachHls(el, url)
    } else {
      el.src = playableUrl(url)
      el.load()
    }

    this.startWatchdog(el)
    this.pendingPlay = true
    try {
      await el.play()
    } finally {
      this.pendingPlay = false
    }
    return useGraph ? 'graph' : 'plain'
  }

  /**
   * Some servers accept the connection and then never send audio. Nothing in
   * the media element reports that, so give a station a bounded time to reach
   * 'playing' before treating it as stuck.
   */
  private startWatchdog(el: HTMLAudioElement): void {
    this.clearWatchdog()
    this.watchdog = window.setTimeout(() => {
      this.watchdog = null
      if (el !== this.active || this.state.status === 'playing') return
      this.scheduleRetry('Station did not start.')
    }, 25000)
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog)
      this.watchdog = null
    }
  }

  private async attachHls(el: HTMLAudioElement, url: string): Promise<void> {
    const canPlayNatively = el.canPlayType('application/vnd.apple.mpegurl') !== ''
    const { default: Hls } = await import('hls.js')
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false })
      this.hls = hls
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        this.scheduleRetry(`HLS error: ${data.details}`)
      })
      hls.loadSource(url)
      hls.attachMedia(el)
      return
    }
    if (canPlayNatively) {
      el.src = url
      el.load()
      return
    }
    throw new Error('HLS is not supported in this browser.')
  }

  // ------------------------------------------------------------ levelling ---

  setLevelingEnabled(on: boolean): void {
    this.levelingEnabled = on
    if (!on) {
      this.stopMetering()
      this.applyLevelGain(0)
      return
    }
    this.updateLevelGain()
    // Switched on mid-play: nothing was measured while it was off, so start
    // now rather than waiting for the next station.
    if (this.state.loudnessLufs === null) this.remeasure()
  }

  setLevelingTarget(lufs: number): void {
    this.levelingTarget = lufs
    this.updateLevelGain()
  }

  /** Called with each new reading so the library can remember it per station. */
  setLoudnessListener(fn: ((lufs: number, gainDb: number) => void) | null): void {
    this.onLoudness = fn
  }

  /**
   * Start working out the correction, and silence the graph until it is known.
   *
   * Returns a promise rather than awaiting: connecting to a stream takes
   * seconds on its own, so the measurement runs alongside it and usually costs
   * no extra time at all. The level gain is dropped to zero meanwhile, which is
   * inaudible — the element has not started producing samples yet — and
   * guarantees nothing is ever heard at the wrong level.
   */
  private beginLevel(url: string): Promise<number | null> {
    if (!this.levelingEnabled) {
      this.setLevelGainNow(1)
      return Promise.resolve(null)
    }

    this.setLevelGainNow(0)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PREROLL_TIMEOUT_MS)
    return measureStreamLoudness(playableUrl(url), { signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    )
  }

  /**
   * Apply the correction and bring the graph up, once audio is ready.
   *
   * Returns whether a measurement was actually obtained. Without one the
   * remembered level from a previous play is used, so the station at least
   * starts near where it was last time rather than raw.
   *
   * The fade is short enough to be heard as the start of playback rather than
   * as a fade, and long enough to avoid a click from a step change in gain.
   */
  private async settleLevel(pending: Promise<number | null>, gen: number): Promise<boolean> {
    let lufs: number | null = null
    try {
      lufs = await pending
    } catch {
      lufs = null
    }
    if (gen !== this.generation) return true

    const measured = lufs !== null
    this.measuredLufs = lufs ?? this.seedLufs
    const db = this.measuredLufs === null ? 0 : correctionDb(this.measuredLufs, this.levelingTarget)

    if (!this.ctx || !this.levelGain) return measured
    const now = this.ctx.currentTime
    const target = this.levelingEnabled ? dbToGain(db) : 1
    this.levelGain.gain.cancelScheduledValues(now)
    this.levelGain.gain.setValueAtTime(this.levelGain.gain.value, now)
    this.levelGain.gain.linearRampToValueAtTime(target, now + LEVEL_FADE_S)

    this.patch({ levelGainDb: this.levelingEnabled ? db : 0 })
    if (lufs !== null) {
      this.patch({ loudnessLufs: lufs })
      this.onLoudness?.(lufs, db)
    }
    return measured
  }

  /** Set the level gain with no ramp; only safe while nothing is audible. */
  private setLevelGainNow(value: number): void {
    if (!this.ctx || !this.levelGain) return
    const now = this.ctx.currentTime
    this.levelGain.gain.cancelScheduledValues(now)
    this.levelGain.gain.setValueAtTime(value, now)
  }

  private applyLevelGain(db: number, timeConstant = 2): void {
    if (!this.ctx || !this.levelGain) return
    const target = this.levelingEnabled ? dbToGain(db) : 1
    // A slow ramp: a fast one on a live measurement is audible as pumping.
    this.levelGain.gain.setTargetAtTime(target, this.ctx.currentTime, timeConstant)
    this.patch({ levelGainDb: this.levelingEnabled ? db : 0 })
  }

  /** Re-derive the gain from the standing measurement, e.g. after a target change. */
  private updateLevelGain(): void {
    if (this.measuredLufs === null) {
      this.applyLevelGain(0)
      return
    }
    this.applyLevelGain(correctionDb(this.measuredLufs, this.levelingTarget))
  }

  /**
   * Measure one window of live audio and apply the result once.
   *
   * Used when the silent pre-roll could not measure, and when levelling is
   * switched on mid-play. The meter samples for LIVE_WINDOW_S, the correction
   * is ramped in slowly enough not to be heard as a change, and then the
   * meter stops: nothing here follows the music.
   */
  private measureLive(gen: number): void {
    this.stopMetering()
    if (!this.meter || !this.levelingEnabled) return
    const meter = this.meter
    meter.reset()

    this.meterTimer = window.setInterval(() => {
      if (gen !== this.generation) {
        this.stopMetering()
        return
      }
      meter.sample()
      if (meter.seconds < LIVE_WINDOW_S) return

      this.stopMetering()
      const lufs = meter.lufs
      // All silence or noise floor: nothing to level against, keep what we had.
      if (lufs === null) return
      this.measuredLufs = lufs
      const db = correctionDb(lufs, this.levelingTarget)
      this.applyLevelGain(db)
      this.patch({ loudnessLufs: lufs })
      this.onLoudness?.(lufs, db)
    }, SAMPLE_INTERVAL_MS)
  }

  /**
   * Level what is playing as if it had just started.
   *
   * Only meaningful mid-play on the graph; a paused or plain-pipeline station
   * has nothing to measure.
   */
  private remeasure(): void {
    if (this.state.status !== 'playing' || this.state.pipeline !== 'graph') return
    this.measureLive(this.generation)
  }

  private stopMetering(): void {
    if (this.meterTimer !== null) {
      clearInterval(this.meterTimer)
      this.meterTimer = null
    }
  }

  /**
   * Measure whether the graph is actually carrying this stream's audio.
   *
   * There is no API for this and no error to catch: WebKit plays the element
   * and hands the graph silence. So watch the analyser while the stream is
   * audibly playing, and if nothing arrives, believe the measurement and fall
   * back to the plain element. The verdict is a property of the browser rather
   * than the station, so it is measured once and remembered.
   */
  private detectGraphRouting(gen: number, req: PlayRequest): void {
    this.clearDetect()
    const startedAt = Date.now()
    let peak = 0

    const sample = (): void => {
      // Deliberately the pre-volume analyser: reading the post-volume one would
      // mistake a muted listener for a graph that is not receiving audio, and
      // the verdict is cached permanently.
      const analyser = this.sourceAnalyser
      if (gen !== this.generation || !analyser) return this.clearDetect()
      const buf = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(buf)
      for (const v of buf) if (v > peak) peak = v

      if (peak > 0) {
        // Routing works here; stop watching and never ask again.
        this.liveStreamGraphOk = true
        writeVerdict(true)
        return this.clearDetect()
      }
      // Only conclude while the stream is genuinely playing, or a slow start
      // would be misread as a starved graph.
      if (this.state.status === 'playing' && Date.now() - startedAt > 4000) {
        this.liveStreamGraphOk = false
        writeVerdict(false)
        this.clearDetect()
        void this.replayWithoutGraph(gen, req)
      }
    }

    this.detectTimer = window.setInterval(sample, 250)
  }

  private clearDetect(): void {
    if (this.detectTimer !== null) {
      clearInterval(this.detectTimer)
      this.detectTimer = null
    }
  }

  /** Re-attach the current stream to the plain element after a failed verdict. */
  private async replayWithoutGraph(gen: number, req: PlayRequest): Promise<void> {
    if (gen !== this.generation) return
    const url = this.graphEl.src || req.url
    // Release the bound element properly: a bare pause() leaves it holding the
    // connection, and the delayed error from clearing src must be invalidated.
    this.streamToken++
    delete this.graphEl.dataset.token
    this.graphEl.pause()
    this.graphEl.removeAttribute('src')
    this.graphEl.load()
    try {
      const pipeline = await this.attach(url, false)
      if (gen !== this.generation) return
      this.patch({ pipeline, capability: 'playback-only', message: NO_LIVE_GRAPH })
    } catch {
      // Leave the original state alone; the stream was audible as it was.
    }
  }

  stop(): void {
    this.generation++
    this.teardownStream()
    this.patch({ status: 'idle', pipeline: null, stationId: null, seekable: false, message: undefined })
  }

  /**
   * Stop listening but stay on the station, and stay the system's player.
   *
   * The element is paused rather than released. macOS (and Chromium's media
   * session on every platform) only treats the app as the Now Playing app
   * while it holds a paused player; an element with its source removed drops
   * out, and the next play from the keyboard, Control Center or a headphone
   * sensor goes to some other app instead.
   *
   * A live stream still has no meaningful paused position, so resuming a
   * stream does not continue this element: resume() declines and the caller
   * reconnects, at whatever is on air then. Holding the connection costs
   * little — once the element stops reading, the server is throttled by TCP.
   * A file keeps its position and resume() continues it.
   */
  pause(): void {
    if (this.state.status === 'idle' || this.state.status === 'paused') return
    this.generation++
    const el = this.active
    // Still connecting: there is no player for the OS to hold on to, and a
    // pending play() is better abandoned than paused.
    if (!el || (!this.isFile && (this.pendingPlay || this.state.status === 'connecting'))) {
      this.teardownStream()
      this.patch({ status: 'paused', pipeline: null, message: undefined })
      return
    }
    this.clearWatchdog()
    this.clearDetect()
    this.stopMetering()
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.hls?.stopLoad()
    el.pause()
    this.patch({ status: 'paused', message: undefined })
  }

  /**
   * Continue a paused file from where it stopped.
   *
   * Returns false when there is nothing to continue — a paused live stream has
   * been disconnected and needs a fresh play() — so the caller knows to do that.
   */
  async resume(): Promise<boolean> {
    const el = this.active
    if (!this.isFile || !el || this.state.status !== 'paused') return false
    this.generation++
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
    this.pendingPlay = true
    try {
      await el.play()
    } catch (err) {
      this.patch({ status: 'error', message: err instanceof Error ? err.message : 'Playback failed.' })
      return true
    } finally {
      this.pendingPlay = false
    }
    return true
  }

  /** Jump to a position in the loaded file. Ignored for streams. */
  seek(seconds: number): void {
    const el = this.active
    if (!this.isFile || !el) return
    const max = Number.isFinite(el.duration) ? el.duration : seconds
    el.currentTime = Math.min(Math.max(0, seconds), max)
    this.emitTiming(el)
  }

  /** Position updates for the loaded file; fires immediately with the current state. */
  subscribeTime(fn: (t: Timing) => void): () => void {
    this.timeListeners.add(fn)
    fn(
      this.active && this.isFile
        ? {
            position: this.active.currentTime,
            duration: Number.isFinite(this.active.duration) ? this.active.duration : null,
          }
        : { position: 0, duration: null },
    )
    return () => this.timeListeners.delete(fn)
  }

  /** Called when a local file plays through to its end. */
  setEndedListener(fn: (() => void) | null): void {
    this.onEnded = fn
  }

  private teardownStream(): void {
    this.clearWatchdog()
    this.clearDetect()
    this.stopMetering()
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.retries = 0
    this.hls?.destroy()
    this.hls = null
    this.streamToken++
    for (const el of [this.graphEl, this.plainEl]) {
      delete el.dataset.token
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    this.active = null
    if (this.isFile) this.emitTiming(null)
  }

  private scheduleRetry(reason: string): void {
    if (!this.active || this.retryTimer !== null || this.state.status === 'paused') return
    const el = this.active
    const url = el.currentSrc || el.src
    if (!url) return
    if (this.retries >= MAX_RETRIES) {
      this.patch({ status: 'error', message: `${reason} Giving up after ${MAX_RETRIES} retries.` })
      return
    }
    const attempt = ++this.retries
    const delay = Math.min(1000 * 2 ** (attempt - 1), 8000)
    this.patch({ status: 'buffering', message: `${reason} Reconnecting…` })
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      if (this.active !== el) return
      el.load()
      void el.play().catch(() => this.scheduleRetry('Reconnect failed.'))
    }, delay)
  }

  // ----------------------------------------------------------- parameters ---

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    this.applyVolume()
  }

  setMuted(m: boolean): void {
    this.muted = m
    this.applyVolume()
  }

  private applyVolume(): void {
    const level = this.muted ? 0 : this.volume
    // The graph path controls level with a GainNode so the analyser sees the
    // signal the listener actually hears; the plain element has no graph, so it
    // falls back to the element's own volume.
    if (this.output) this.output.gain.value = level
    this.plainEl.volume = level
    // Keep the bound element wide open: its level is set downstream.
    this.graphEl.volume = 1
  }

  setBandGain(index: number, db: number): void {
    this.writeBand(index, db)
    this.updatePreGain()
  }

  setAllGains(gains: number[]): void {
    for (let i = 0; i < BAND_COUNT; i++) this.writeBand(i, gains[i] ?? 0)
    this.updatePreGain()
  }

  private writeBand(index: number, db: number): void {
    this.gains[index] = db
    const f = this.filters[index]
    if (f && this.ctx) f.gain.setTargetAtTime(db, this.ctx.currentTime, 0.01)
  }

  setPreamp(db: number): void {
    this.preampDb = db
    this.updatePreGain()
  }

  /**
   * The gain applied ahead of the filter bank, in dB.
   *
   * A boost can only be clean if there is room above the signal for it:
   * material mastered to 0 dBFS plus +8 dB of bass is well over, and the
   * limiter would have to duck the whole mix to hold it. So the curve's
   * boost is cancelled automatically, weighted by where music has energy (see
   * eqHeadroomDb): a bass boost gets its full height back, while a treble
   * boost costs almost nothing, so it is heard as more treble rather than as
   * everything else getting quieter. It depends only on the curve, never on the music,
   * so it cannot pump.
   *
   * The user's preamp is an offset from that clip-safe level, not an
   * alternative to it: every position of the slider is heard, and pushing it
   * above 0 is a deliberate choice to drive the limiter.
   *
   * With the EQ bypassed the preamp goes too — it is part of the equalizer.
   */
  private preGainDb(): number {
    if (!this.eqEnabled) return 0
    const rate = this.ctx?.sampleRate ?? 48000
    return this.preampDb - eqHeadroomDb(this.gains, rate)
  }

  private updatePreGain(): void {
    if (this.preamp && this.ctx) {
      this.preamp.gain.setTargetAtTime(dbToGain(this.preGainDb()), this.ctx.currentTime, 0.01)
    }
  }

  /** Bypass routes around the filter bank without tearing the graph down. */
  setEqEnabled(enabled: boolean): void {
    this.eqEnabled = enabled
    this.updatePreGain()
    this.rebuildChain()
  }

  // ------------------------------------------------------------------- fx ---

  setReverbEnabled(enabled: boolean): void {
    this.reverbEnabled = enabled
    this.rebuildChain()
  }

  /** Re-renders the impulse response, so call it on commit rather than on drag. */
  setReverbImpulse(opts: ImpulseOptions): void {
    this.reverbOpts = opts
    if (this.ctx && this.convolver) {
      this.convolver.buffer = renderImpulseResponse(this.ctx, opts)
    }
  }

  /**
   * Equal-power crossfade between dry and wet. A linear fade would dip in
   * loudness around the middle, because the two signals are uncorrelated and
   * sum by power rather than amplitude.
   */
  setReverbMix(mix: number): void {
    this.reverbMix = Math.min(1, Math.max(0, mix))
    if (!this.ctx || !this.dryGain || !this.wetGain) return
    const t = this.ctx.currentTime
    this.dryGain.gain.setTargetAtTime(Math.cos((this.reverbMix * Math.PI) / 2), t, 0.02)
    this.wetGain.gain.setTargetAtTime(Math.sin((this.reverbMix * Math.PI) / 2), t, 0.02)
  }

  setPreDelay(ms: number): void {
    this.preDelayMs = ms
    if (this.ctx && this.preDelayNode) {
      this.preDelayNode.delayTime.setTargetAtTime(ms / 1000, this.ctx.currentTime, 0.02)
    }
  }

  setWidthEnabled(enabled: boolean): void {
    this.widthEnabled = enabled
    this.rebuildChain()
  }

  setWidth(width: number): void {
    this.width = Math.min(2, Math.max(0, width))
    if (this.ctx && this.sideBus) {
      this.sideBus.gain.setTargetAtTime(this.width, this.ctx.currentTime, 0.02)
    }
  }

  // -------------------------------------------------------------- observer ---

  subscribe(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  getState(): EngineState {
    return this.state
  }

  private patch(next: Partial<EngineState>): void {
    this.state = { ...this.state, ...next }
    for (const fn of this.listeners) fn(this.state)
  }
}

function describeMediaError(err: MediaError | null): string {
  switch (err?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Playback aborted.'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Network error.'
    case MediaError.MEDIA_ERR_DECODE:
      return 'Could not decode this stream.'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'Stream format unsupported, or blocked by the browser.'
    default:
      return 'Playback error.'
  }
}

/** Whether the main process can find a local file; errs on the side of yes. */
async function fileExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(playableUrl(url), { method: 'HEAD', cache: 'no-store' })
    return res.status !== 404
  } catch {
    return true
  }
}

function describeFileError(err: MediaError | null): string {
  switch (err?.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Could not read the file. Is the drive still connected?'
    case MediaError.MEDIA_ERR_DECODE:
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'This file format is not supported.'
    default:
      return describeMediaError(err)
  }
}

export const engine = new AudioEngine()
