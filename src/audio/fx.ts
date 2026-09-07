/**
 * Impulse responses and effect definitions for the Space rack.
 *
 * A ConvolverNode needs an impulse response, and shipping .wav files for each
 * room would mean megabytes of assets for a browser-only app. Instead every IR
 * is synthesised at runtime from decaying noise, which is cheap (a few
 * milliseconds) and lets the room size be a live control rather than a fixed
 * recording.
 */

export interface ReverbPreset {
  id: string
  name: string
  /** Tail length in seconds. */
  seconds: number
  /** Exponent of the amplitude envelope; higher decays faster at the start. */
  decay: number
  /** 0 = bright tail, 1 = heavily damped/dark tail. */
  damping: number
  /** Discrete early reflections as [milliseconds, gain]. Plates have none. */
  early: Array<[number, number]>
  /** Default wet level for this space. */
  mix: number
  preDelayMs: number
}

export const REVERB_PRESETS: ReverbPreset[] = [
  {
    id: 'room', name: 'Room', seconds: 0.9, decay: 2.4, damping: 0.78,
    early: [[7, 0.5], [13, 0.38], [21, 0.28], [33, 0.18]], mix: 0.18, preDelayMs: 8,
  },
  {
    id: 'club', name: 'Club', seconds: 1.5, decay: 2.0, damping: 0.7,
    early: [[11, 0.45], [19, 0.34], [29, 0.26], [43, 0.17]], mix: 0.24, preDelayMs: 14,
  },
  {
    id: 'hall', name: 'Hall', seconds: 2.9, decay: 1.8, damping: 0.6,
    early: [[17, 0.4], [29, 0.3], [47, 0.22], [71, 0.15]], mix: 0.3, preDelayMs: 24,
  },
  {
    id: 'cathedral', name: 'Cathedral', seconds: 5.2, decay: 1.4, damping: 0.44,
    early: [[23, 0.34], [41, 0.27], [67, 0.2], [103, 0.14]], mix: 0.36, preDelayMs: 38,
  },
  {
    id: 'plate', name: 'Plate', seconds: 2.1, decay: 1.2, damping: 0.22,
    early: [], mix: 0.26, preDelayMs: 6,
  },
]

export const DEFAULT_REVERB = REVERB_PRESETS[2]!

export interface ImpulseOptions {
  seconds: number
  decay: number
  damping: number
  early: Array<[number, number]>
}

/**
 * Build a stereo impulse response.
 *
 * Plain exponentially-decaying white noise is the usual one-liner, but it
 * sounds like a hiss rather than a room. Two things fix that cheaply: a
 * one-pole lowpass whose cutoff falls across the tail, because real rooms
 * absorb treble faster than bass; and a handful of discrete early reflections
 * at the front, which is most of what tells the ear how big the space is. The
 * two channels use independent noise so the tail is decorrelated and wide.
 */
export function renderImpulseResponse(
  ctx: BaseAudioContext,
  { seconds, decay, damping, early }: ImpulseOptions,
): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(seconds * rate))
  const buffer = ctx.createBuffer(2, length, rate)

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < length; i++) {
      const t = i / length
      // Filter coefficient falls from 1 (open) toward 1 - damping as the tail
      // ages, so the reverb darkens the way a real space does.
      const a = Math.max(0.02, 1 - damping * t)
      lp += ((Math.random() * 2 - 1) - lp) * a
      data[i] = lp * Math.pow(1 - t, decay)
    }
    // Early reflections, slightly offset per channel so they do not collapse
    // to the centre of the stereo image.
    for (const [ms, gain] of early) {
      const index = Math.floor(((ms + (ch === 0 ? 0 : 1.7)) / 1000) * rate)
      if (index < length) data[index] += gain * (ch === 0 ? 1 : 0.86)
    }
  }
  return buffer
}

export const WIDTH_MIN = 0
export const WIDTH_MAX = 2
