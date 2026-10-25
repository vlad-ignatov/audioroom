/**
 * Loudness measurement, for levelling stations against each other.
 *
 * Peak and plain RMS both correlate poorly with how loud a station *sounds*: a
 * heavily compressed pop station and a sparse jazz one can share a peak level
 * and still differ by 10 dB to the ear. So this follows ITU-R BS.1770, the
 * measure ReplayGain and every broadcast loudness standard are built on:
 *
 *   1. K-weighting — a high shelf and a high-pass that together approximate
 *      how the head and ear respond across the spectrum.
 *   2. Mean square over short blocks, converted to LUFS.
 *   3. Two-stage gating, so silence and quiet passages do not drag the average
 *      down and make the next loud passage jump.
 *
 * It is an approximation in one respect: BS.1770 specifies 400 ms blocks with
 * 75% overlap, and this samples the analyser's window on a timer instead.
 * That costs a little accuracy in exchange for running on an AnalyserNode
 * rather than an AudioWorklet, and the residual error is well under the
 * differences between stations that we are correcting for.
 */

/** Loudness of digital silence; blocks below this are ignored entirely. */
const ABSOLUTE_GATE_LUFS = -70
/** BS.1770 relative gate: blocks more than this far below the mean are dropped. */
const RELATIVE_GATE_LU = -10
/** The -0.691 offset that aligns K-weighted mean square with LUFS. */
const LUFS_OFFSET = -0.691

/** Roughly a minute of blocks at the sampling interval below. */
const MAX_BLOCKS = 600
export const SAMPLE_INTERVAL_MS = 100

/** Streaming radio clusters near this; it is also the Spotify/YouTube target. */
export const DEFAULT_TARGET_LUFS = -16

export interface LoudnessTap {
  /** Connect the signal to be measured here. */
  input: AudioNode
  analyser: AnalyserNode
}

/**
 * Build the K-weighting pre-filter and the analyser that reads it.
 *
 * Frequencies and gains are the constants from the specification rather than
 * anything tuned by ear.
 */
export function createLoudnessTap(ctx: AudioContext): LoudnessTap {
  // Stage 1: shelving filter modelling the acoustic effect of the head.
  const shelf = ctx.createBiquadFilter()
  shelf.type = 'highshelf'
  shelf.frequency.value = 1681.97
  shelf.gain.value = 3.999

  // Stage 2: RLB high-pass, which discards sub-bass the ear barely weighs.
  const highpass = ctx.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 38.13
  highpass.Q.value = 0.5

  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  // Time-domain reads must not be smoothed; we do our own averaging.
  analyser.smoothingTimeConstant = 0

  shelf.connect(highpass)
  highpass.connect(analyser)

  return { input: shelf, analyser }
}

function meanSquareToLufs(meanSquare: number): number {
  return LUFS_OFFSET + 10 * Math.log10(meanSquare)
}

/**
 * Rolling gated loudness over the recent past.
 *
 * A live stream has no end, so "integrated" here means the last minute or so
 * rather than the whole programme. That is deliberate: a station that changes
 * character between shows should re-level within a reasonable time.
 */
export class LoudnessMeter {
  private readonly buffer: Float32Array<ArrayBuffer>
  /** Mean square per block, oldest first. */
  private blocks: number[] = []

  constructor(private readonly analyser: AnalyserNode) {
    this.buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4))
  }

  /** Read one window from the analyser. Call on a timer while playing. */
  sample(): void {
    this.analyser.getFloatTimeDomainData(this.buffer)
    let sum = 0
    for (let i = 0; i < this.buffer.length; i++) {
      const v = this.buffer[i]!
      sum += v * v
    }
    const meanSquare = sum / this.buffer.length
    // Exactly zero happens while the graph is starved or paused; it carries no
    // information and log10(0) is -Infinity.
    if (meanSquare <= 0) return

    this.blocks.push(meanSquare)
    if (this.blocks.length > MAX_BLOCKS) this.blocks.shift()
  }

  /** How much material has been measured, in seconds. */
  get seconds(): number {
    return (this.blocks.length * SAMPLE_INTERVAL_MS) / 1000
  }

  /**
   * Gated loudness in LUFS, or null before there is enough signal to be
   * meaningful. The caller decides how long to wait before trusting it.
   */
  get lufs(): number | null {
    if (this.blocks.length === 0) return null

    // First gate: drop anything at or below the noise floor.
    const audible = this.blocks.filter((ms) => meanSquareToLufs(ms) > ABSOLUTE_GATE_LUFS)
    if (audible.length === 0) return null

    // Second gate: drop anything far below the average of what remains, so
    // quiet intros and speech pauses do not pull the result down.
    const mean = audible.reduce((a, b) => a + b, 0) / audible.length
    const threshold = meanSquareToLufs(mean) + RELATIVE_GATE_LU
    const loud = audible.filter((ms) => meanSquareToLufs(ms) > threshold)
    if (loud.length === 0) return null

    const gatedMean = loud.reduce((a, b) => a + b, 0) / loud.length
    return meanSquareToLufs(gatedMean)
  }

  reset(): void {
    this.blocks = []
  }
}

/**
 * The correction to apply, in dB, clamped so a very quiet station cannot be
 * amplified into noise and a very loud one cannot be buried.
 */
export function correctionDb(
  measuredLufs: number,
  targetLufs: number,
  maxBoostDb = 12,
  maxCutDb = 12,
): number {
  const wanted = targetLufs - measuredLufs
  return Math.max(-maxCutDb, Math.min(maxBoostDb, wanted))
}

// ---------------------------------------------------------------------------
// Measuring before playback
//
// The realtime meter above can only learn a station's loudness while it is
// already audible, which means the first seconds of a loud station arrive at
// full blast. Fetching a few seconds of the stream and measuring it offline
// removes that entirely: the correction is known before a single sample is
// heard. This path also runs the real BS.1770 block algorithm rather than the
// timer approximation, because it has the whole signal in hand.
// ---------------------------------------------------------------------------

/** BS.1770 measurement blocks: 400 ms long, overlapping by 75%. */
const BLOCK_MS = 400
const HOP_MS = 100

/**
 * Gated loudness of decoded audio, in LUFS.
 *
 * One deliberate deviation from BS.1770: the signal is measured as a mono
 * downmix rather than a weighted sum of channels. The realtime meter reads
 * through an AnalyserNode, which downmixes whatever it is given, and the two
 * paths must agree — a fixed 3 dB disagreement between them would make the
 * live meter constantly "correct" the pre-roll figure. Downmixing is the only
 * treatment that is identical for mono streams, stereo streams, and a mono
 * stream that Web Audio has upmixed to two channels.
 *
 * The cost is that stereo material reads up to 3 dB below its true BS.1770
 * value. Since every station is measured the same way, the levelling between
 * them — the thing being fixed — is unaffected.
 */
export function gatedLoudness(channels: Float32Array[], sampleRate: number): number | null {
  if (channels.length === 0) return null
  const blockSize = Math.floor((BLOCK_MS / 1000) * sampleRate)
  const hop = Math.floor((HOP_MS / 1000) * sampleRate)
  const length = channels[0]!.length
  if (length < blockSize) return null

  const blocks: number[] = []
  for (let start = 0; start + blockSize <= length; start += hop) {
    let summed = 0
    for (const data of channels) {
      let sum = 0
      for (let i = start; i < start + blockSize; i++) {
        const v = data[i]!
        sum += v * v
      }
      summed += sum / blockSize
    }
    if (summed > 0) blocks.push(summed)
  }
  if (blocks.length === 0) return null

  const loudnessOf = (meanSquare: number) => LUFS_OFFSET + 10 * Math.log10(meanSquare)

  const audible = blocks.filter((ms) => loudnessOf(ms) > ABSOLUTE_GATE_LUFS)
  if (audible.length === 0) return null

  const mean = audible.reduce((a, b) => a + b, 0) / audible.length
  const threshold = loudnessOf(mean) + RELATIVE_GATE_LU
  const loud = audible.filter((ms) => loudnessOf(ms) > threshold)
  if (loud.length === 0) return null

  return loudnessOf(loud.reduce((a, b) => a + b, 0) / loud.length)
}

/** Apply the K-weighting filters offline, then measure what comes out. */
async function measureAudioBuffer(buffer: AudioBuffer): Promise<number | null> {
  // A mono destination makes Web Audio perform the downmix, exactly as the
  // AnalyserNode does in the realtime path.
  const ctx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer

  const tap = createLoudnessTap(ctx as unknown as AudioContext)
  source.connect(tap.input)
  // The tap ends in an analyser, which is a sink offline; take the filtered
  // signal to the destination so it is actually rendered.
  tap.analyser.connect(ctx.destination)
  source.start()

  const rendered = await ctx.startRendering()
  const channels: Float32Array[] = []
  for (let c = 0; c < rendered.numberOfChannels; c++) channels.push(rendered.getChannelData(c))
  return gatedLoudness(channels, rendered.sampleRate)
}

/** Roughly how many bytes hold `seconds` of audio at a given bitrate. */
function bytesFor(seconds: number, bitrateKbps: number): number {
  return Math.ceil((bitrateKbps * 1000 * seconds) / 8)
}

/**
 * Fetch the opening of a stream and measure it, without playing anything.
 *
 * Returns null rather than throwing for every failure mode — an unreachable
 * server, a codec the decoder will not take from a partial chunk, a playlist
 * rather than audio — because the caller can always fall back to measuring
 * during playback.
 */
export async function measureStreamLoudness(
  url: string,
  { seconds = 6, bitrateKbps = 128, signal }: {
    seconds?: number
    bitrateKbps?: number
    signal?: AbortSignal
  } = {},
): Promise<number | null> {
  // A playlist is not audio; hls.js would have to assemble it first.
  if (/\.m3u8(\?|$)/i.test(url)) return null

  const wanted = bytesFor(seconds, bitrateKbps)
  let decodeCtx: OfflineAudioContext | null = null

  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-store', signal })
    if (!res.ok || !res.body) return null

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (total < wanted) {
        const { done, value } = await reader.read()
        if (done || !value) break
        chunks.push(value)
        total += value.length
      }
    } finally {
      void reader.cancel().catch(() => {})
    }
    if (total === 0) return null

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }

    // decodeAudioData needs some context to decode against; the parameters are
    // irrelevant because the decoded buffer keeps the stream's own rate.
    decodeCtx = new OfflineAudioContext(1, 1, 44100)
    const decoded = await decodeCtx.decodeAudioData(bytes.buffer as ArrayBuffer)
    return await measureAudioBuffer(decoded)
  } catch {
    return null
  }
}

/**
 * Files larger than this are not measured: decoding holds the whole track in
 * memory, about 350 MB for an hour of stereo even at the reduced rate below.
 * 80 MB is half an hour of 320 kbps MP3, or a long song in FLAC.
 */
const MAX_FILE_BYTES = 80 * 1024 * 1024

/**
 * The rate files are decoded at for measuring. The decoder resamples to the
 * context's rate; at half the usual rate a track takes half the memory, and
 * what is lost above 11 kHz moved four rock tracks' readings by 0.06 LU at most.
 */
const FILE_MEASURE_RATE = 22050

/**
 * Loudness of a whole local file, in LUFS, measured the same way as a stream.
 *
 * A song's opening says nothing reliable about the song: intros are quiet, and
 * levelling a track by its first seconds boosted a loud one by 12 dB. So the
 * file is fetched and decoded whole, with Chromium's own decoders — every
 * format that plays can be measured, with nothing to install.
 *
 * Null for a file too large to decode in memory, one that will not decode, or
 * when aborted.
 */
export async function measureFileLoudness(url: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const size = Number(res.headers.get('Content-Length'))
    if (size > MAX_FILE_BYTES) {
      void res.body?.cancel().catch(() => {})
      return null
    }
    const bytes = await res.arrayBuffer()
    if (signal?.aborted) return null
    const decoded = await new OfflineAudioContext(1, 1, FILE_MEASURE_RATE).decodeAudioData(bytes)
    if (signal?.aborted) return null
    return await measureAudioBuffer(decoded)
  } catch {
    return null
  }
}
