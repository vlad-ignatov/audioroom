/**
 * Ten ISO octave-band centres. Band 0 is a low shelf and band 9 a high shelf so
 * the extremes actually move the energy below 31 Hz / above 16 kHz rather than
 * leaving it untouched; everything between is a peaking filter.
 */
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

export const BAND_COUNT = EQ_FREQUENCIES.length

/** One octave bandwidth: Q = sqrt(2) / (2^1 - 1) ≈ 1.414. */
export const BAND_Q = Math.SQRT2

export const GAIN_MIN = -12
export const GAIN_MAX = 12

export function filterTypeForBand(index: number): BiquadFilterType {
  if (index === 0) return 'lowshelf'
  if (index === BAND_COUNT - 1) return 'highshelf'
  return 'peaking'
}

export function formatFrequency(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz)
}

export interface EqPreset {
  id: string
  name: string
  /** dB per band, length must equal BAND_COUNT. */
  gains: number[]
  /**
   * dB offset ahead of the filter chain. Headroom for boosts is made
   * automatically, so 0 is already clip-safe; this is purely a level trim.
   */
  preamp: number
  builtin: boolean
}

const flat = () => new Array(BAND_COUNT).fill(0) as number[]

export const BUILTIN_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Flat', gains: flat(), preamp: 0, builtin: true },
  { id: 'rock', name: 'Rock', gains: [5, 4, 2, -1, -2, -1, 2, 4, 5, 5], preamp: 0, builtin: true },
  { id: 'pop', name: 'Pop', gains: [-1, 1, 3, 4, 3, 1, -1, -1, 0, 1], preamp: 0, builtin: true },
  { id: 'jazz', name: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3], preamp: 0, builtin: true },
  { id: 'classical', name: 'Classical', gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4], preamp: 0, builtin: true },
  { id: 'vocal', name: 'Vocal', gains: [-3, -2, 0, 2, 4, 4, 3, 1, 0, -1], preamp: 0, builtin: true },
  { id: 'bass', name: 'Bass Boost', gains: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0], preamp: 0, builtin: true },
  { id: 'treble', name: 'Treble Boost', gains: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7], preamp: 0, builtin: true },
  { id: 'loudness', name: 'Loudness', gains: [6, 5, 2, 0, -1, -1, 0, 2, 5, 6], preamp: 0, builtin: true },
]

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * Magnitude response of one band in dB at `hz`, using the Web Audio spec's
 * biquad coefficients (Audio EQ Cookbook, shelves with slope S = 1). Computed
 * here rather than read back from the live nodes, whose parameters may still
 * be mid-ramp when asked.
 */
function bandResponseDb(type: BiquadFilterType, f0: number, gainDb: number, hz: number, sampleRate: number): number {
  if (gainDb === 0) return 0
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * f0) / sampleRate
  const cos0 = Math.cos(w0)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  if (type === 'peaking') {
    const alpha = Math.sin(w0) / (2 * BAND_Q)
    b0 = 1 + alpha * A
    b1 = -2 * cos0
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cos0
    a2 = 1 - alpha / A
  } else {
    const k = 2 * Math.sqrt(A) * (Math.sin(w0) / Math.SQRT2)
    const s = type === 'lowshelf' ? 1 : -1
    b0 = A * (A + 1 - s * (A - 1) * cos0 + k)
    b1 = s * 2 * A * (A - 1 - s * (A + 1) * cos0)
    b2 = A * (A + 1 - s * (A - 1) * cos0 - k)
    a0 = A + 1 + s * (A - 1) * cos0 + k
    a1 = -s * 2 * (A - 1 + s * (A + 1) * cos0)
    a2 = A + 1 + s * (A - 1) * cos0 - k
  }
  // |H(e^jw)| for H(z) = (b0 + b1 z^-1 + b2 z^-2) / (a0 + a1 z^-1 + a2 z^-2)
  const w = (2 * Math.PI * hz) / sampleRate
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  const num = Math.hypot(b0 + b1 * c1 + b2 * c2, b1 * s1 + b2 * s2)
  const den = Math.hypot(a0 + a1 * c1 + a2 * c2, a1 * s1 + a2 * s2)
  return 20 * Math.log10(num / den)
}

/**
 * Rough long-term spectrum of mixed music, as power per octave in dB: flat
 * through the bass and low mids, falling about 5 dB per octave above 500 Hz
 * and 6 dB per octave below 50 Hz. Most of a track's energy, and so its
 * peaks, lives low; 16 kHz carries around 25 dB less than 250 Hz.
 */
function musicSpectrumDb(hz: number): number {
  if (hz < 50) return -6 * Math.log2(50 / hz)
  if (hz > 500) return -5 * Math.log2(hz / 500)
  return 0
}

/**
 * The headroom the filter bank needs, in dB (0 or more): the largest boost it
 * applies anywhere in 20 Hz–20 kHz, with each frequency's boost discounted by
 * how far typical music there sits below its loudest region.
 *
 * A boost only threatens clipping where there is energy for it to raise.
 * +12 dB at 16 kHz is a +12 dB peak in the response, but music there is some
 * 25 dB down, so it barely moves the waveform's peaks; cancelling it in full
 * would drop everything else by 12 dB. The same boost in the bass, where the
 * energy is, still gets its full height back. Adjacent boosted bands overlap,
 * so this can exceed the highest single slider — two neighbours at +6 in the
 * bass peak near +8 between them.
 */
export function eqHeadroomDb(gains: readonly number[], sampleRate: number): number {
  if (!gains.some((g) => g > 0)) return 0
  let peak = 0
  const steps = 240
  for (let i = 0; i <= steps; i++) {
    const hz = 20 * Math.pow(1000, i / steps)
    if (hz >= sampleRate / 2) break
    let total = musicSpectrumDb(hz)
    for (let b = 0; b < BAND_COUNT; b++) {
      total += bandResponseDb(filterTypeForBand(b), EQ_FREQUENCIES[b]!, gains[b] ?? 0, hz, sampleRate)
    }
    peak = Math.max(peak, total)
  }
  return peak
}
