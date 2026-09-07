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
  /** dB applied ahead of the filter chain, to claw back headroom when boosting. */
  preamp: number
  builtin: boolean
}

const flat = () => new Array(BAND_COUNT).fill(0) as number[]

export const BUILTIN_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Flat', gains: flat(), preamp: 0, builtin: true },
  { id: 'rock', name: 'Rock', gains: [5, 4, 2, -1, -2, -1, 2, 4, 5, 5], preamp: -3, builtin: true },
  { id: 'pop', name: 'Pop', gains: [-1, 1, 3, 4, 3, 1, -1, -1, 0, 1], preamp: -2, builtin: true },
  { id: 'jazz', name: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3], preamp: -2, builtin: true },
  { id: 'classical', name: 'Classical', gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4], preamp: -2, builtin: true },
  { id: 'vocal', name: 'Vocal', gains: [-3, -2, 0, 2, 4, 4, 3, 1, 0, -1], preamp: -2, builtin: true },
  { id: 'bass', name: 'Bass Boost', gains: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0], preamp: -4, builtin: true },
  { id: 'treble', name: 'Treble Boost', gains: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7], preamp: -3, builtin: true },
  { id: 'loudness', name: 'Loudness', gains: [6, 5, 2, 0, -1, -1, 0, 2, 5, 6], preamp: -4, builtin: true },
]

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}
