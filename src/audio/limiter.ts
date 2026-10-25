/**
 * Multiband peak limiter: the last stage before the volume control.
 *
 * Boosting a band of a track mastered to full scale pushes its peaks over
 * 0 dBFS; something has to hold them. A full-band limiter does it by turning
 * the whole mix down, so a boosted kick drum ducks the vocals with it. Here
 * the signal is split into three bands, each limited on its own, and summed
 * back: a bass hit that would clip pulls down the bass and nothing else.
 *
 *   input ─┬─ LR4 lowpass 150 Hz ── allpass 4 kHz ──── limiter ─┐
 *          └─ LR4 highpass 150 Hz ┬─ LR4 lowpass 4 kHz ─ limiter ─┼─ sum ─ soft clip ─ output
 *                                 └─ LR4 highpass 4 kHz  limiter ─┘
 *
 * Linkwitz–Riley crossovers sum back to a flat magnitude, so while nothing is
 * being limited the stage changes nothing audible (only phase, around the
 * crossover points). The bass band also passes an allpass matching the
 * phase the other two bands pick up at the upper crossover, or the sum would
 * dip there.
 *
 * Bands sit a little under full scale (see LIMITER_BANDS) so bands peaking
 * together mostly still fit; a soft clipper rounds off whatever does not.
 */

export const LIMITER_BANDS = [
  // A bass cycle is 20–30 ms: an attack faster than that would reshape the
  // waveform (heard as distortion), and a quick release would pump.
  //
  // The bass ceiling is lower because bass carries a mix's biggest peaks, and
  // everything else rides on top of them: at -1 dBFS a limited kick plus the
  // vocal over it still reached the clipper, which shaved ~1.5 dB off the
  // vocal on every hit. At -3 dBFS that drops to ~0.3 dB, while a flat EQ on
  // a track peaking at -0.3 dBFS is still changed by only -41 dB (measured
  // offline in Chromium against the same crossovers, unlimited).
  { name: 'bass', ceiling: -3, attack: 0.01, release: 0.3 },
  { name: 'mids', ceiling: -1, attack: 0.003, release: 0.15 },
  { name: 'treble', ceiling: -1, attack: 0.002, release: 0.1 },
] as const

export type LimiterBand = (typeof LIMITER_BANDS)[number]['name']

/** Crossover frequencies between bass/mids and mids/treble, Hz. */
const CROSSOVERS = [150, 4000] as const

/** The limiter band that handles a given frequency. */
export function limiterBandAt(hz: number): LimiterBand {
  return hz < CROSSOVERS[0] ? 'bass' : hz < CROSSOVERS[1] ? 'mids' : 'treble'
}

const RATIO = 20

/**
 * Web Audio reads a lowpass/highpass Q in dB, not as a plain ratio; a
 * Butterworth section is Q = 1/√2, i.e. -3.01 dB.
 */
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2)

/**
 * The gain DynamicsCompressorNode adds on its own, in dB.
 *
 * The spec has it apply "makeup gain" to everything, derived from its curve:
 * (1 / curve(0 dBFS))^0.6. With a hard knee the curve maps 0 dBFS to
 * T(1 - 1/R), so a -1 dB threshold at 20:1 lifts the whole band by ~0.57 dB
 * — tone-changing, and constant. It is cancelled after each band.
 */
function makeupDb(thresholdDb: number, ratio: number): number {
  return -0.6 * thresholdDb * (1 - 1 / ratio)
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/** Fourth-order Linkwitz–Riley: two Butterworth sections in series. */
function lr4(ctx: BaseAudioContext, type: 'lowpass' | 'highpass', hz: number) {
  const make = () => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = hz
    f.Q.value = BUTTERWORTH_Q_DB
    return f
  }
  const a = make()
  const b = make()
  a.connect(b)
  return { input: a, output: b }
}

function limiter(
  ctx: BaseAudioContext,
  thresholdDb: number,
  attack: number,
  release: number,
): DynamicsCompressorNode {
  const node = ctx.createDynamicsCompressor()
  node.threshold.value = thresholdDb
  node.knee.value = 0
  node.ratio.value = RATIO
  node.attack.value = attack
  node.release.value = release
  return node
}

/** Where the soft clipper starts to bend, dBFS; linear below. */
const CLIP_KNEE_DB = -1
/** The largest input the clipper shapes; anything above sits at full scale. */
const CLIP_RANGE = 4

/**
 * Transparent below CLIP_KNEE_DB, then a tanh curve that approaches but never
 * reaches full scale, so the output cannot clip however hot the input.
 *
 * A WaveShaper only reads inputs in [-1, 1], so the signal is scaled into
 * that range first and the curve is drawn over the real values.
 */
function softClipper(ctx: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const knee = dbToGain(CLIP_KNEE_DB)
  const n = 8193
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * CLIP_RANGE
    const mag = Math.abs(x)
    curve[i] = mag <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((mag - knee) / (1 - knee)))
  }
  const scale = ctx.createGain()
  scale.gain.value = 1 / CLIP_RANGE
  const shaper = ctx.createWaveShaper()
  shaper.curve = curve
  // Shaping creates harmonics; oversampling keeps them from folding back
  // down as aliasing.
  shaper.oversample = '4x'
  scale.connect(shaper)
  return { input: scale, output: shaper }
}

export interface MultibandLimiter {
  input: AudioNode
  output: AudioNode
  /** Current gain reduction per band, dB (0 or less). */
  reduction(): { band: LimiterBand; db: number }[]
}

export function createMultibandLimiter(ctx: BaseAudioContext): MultibandLimiter {
  const input = ctx.createGain()
  const sum = ctx.createGain()

  const lowSplit = lr4(ctx, 'lowpass', CROSSOVERS[0])
  const highSplit = lr4(ctx, 'highpass', CROSSOVERS[0])
  const midSplit = lr4(ctx, 'lowpass', CROSSOVERS[1])
  const topSplit = lr4(ctx, 'highpass', CROSSOVERS[1])

  // The LR4 pair at 4 kHz sums to a second-order allpass with Q = 1/√2
  // (allpass Q is a plain ratio). Give the bass band the same phase.
  const phase = ctx.createBiquadFilter()
  phase.type = 'allpass'
  phase.frequency.value = CROSSOVERS[1]
  phase.Q.value = Math.SQRT1_2

  input.connect(lowSplit.input)
  input.connect(highSplit.input)
  lowSplit.output.connect(phase)
  highSplit.output.connect(midSplit.input)
  highSplit.output.connect(topSplit.input)

  const sources: AudioNode[] = [phase, midSplit.output, topSplit.output]
  const bands = LIMITER_BANDS.map((band, i) => {
    const node = limiter(ctx, band.ceiling, band.attack, band.release)
    const trim = ctx.createGain()
    trim.gain.value = dbToGain(-makeupDb(band.ceiling, RATIO))
    sources[i]!.connect(node).connect(trim).connect(sum)
    return { band: band.name as LimiterBand, node }
  })

  // What the bands let through together — two bands peaking at once, the
  // few milliseconds before a limiter reacts — is rounded off here rather
  // than limited. A limiter would turn the whole mix down for it, which is
  // the ducking the bands exist to avoid; these overs are small and brief
  // enough that shaving their tips is inaudible.
  const clipper = softClipper(ctx)
  sum.connect(clipper.input)

  return {
    input,
    output: clipper.output,
    reduction: () => bands.map(({ band, node }) => ({ band, db: node.reduction })),
  }
}
