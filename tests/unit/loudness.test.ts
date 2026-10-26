import { describe, expect, it } from 'vitest'
import { LoudnessMeter, correctionDb, gatedLoudness } from '@/audio/loudness'

const RATE = 48000

/** A sine of the given peak amplitude, `seconds` long. */
function sine(amplitude: number, seconds: number, hz = 1000): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE)
  return out
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** BS.1770 loudness of a steady sine, already K-weighted: mean square A²/2. */
const expectedLufs = (amplitude: number) => -0.691 + 10 * Math.log10((amplitude * amplitude) / 2)

describe('gatedLoudness', () => {
  it('measures a steady tone by the BS.1770 formula', () => {
    expect(gatedLoudness([sine(0.1, 3)], RATE)).toBeCloseTo(expectedLufs(0.1), 2)
    expect(gatedLoudness([sine(0.5, 3)], RATE)).toBeCloseTo(expectedLufs(0.5), 2)
  })

  it('is 6 dB louder for twice the amplitude', () => {
    const quiet = gatedLoudness([sine(0.1, 2)], RATE)!
    const loud = gatedLoudness([sine(0.2, 2)], RATE)!
    expect(loud - quiet).toBeCloseTo(20 * Math.log10(2), 2)
  })

  it('ignores silence, so a gap does not pull the result down', () => {
    const tone = gatedLoudness([sine(0.3, 3)], RATE)!
    const withGap = gatedLoudness([concat(sine(0.3, 3), new Float32Array(RATE * 5))], RATE)!
    // Averaged plainly, 5 s of silence after 3 s of tone would read 4.3 dB
    // quieter. Only the few blocks straddling the edge count, part silent.
    expect(Math.abs(withGap - tone)).toBeLessThan(0.5)
  })

  it('drops passages far below the rest (the relative gate)', () => {
    const loud = gatedLoudness([sine(0.5, 4)], RATE)!
    // 30 dB down: well past the -10 LU gate.
    const withQuietIntro = gatedLoudness([concat(sine(0.5 / 31.6, 4), sine(0.5, 4))], RATE)!
    expect(withQuietIntro).toBeCloseTo(loud, 0)
  })

  it('keeps passages within the gate, which lowers the result', () => {
    const loud = gatedLoudness([sine(0.5, 4)], RATE)!
    // 3 dB down: inside the gate, so it counts.
    const mixed = gatedLoudness([concat(sine(0.5 / 1.41, 4), sine(0.5, 4))], RATE)!
    expect(mixed).toBeLessThan(loud - 1)
  })

  it('returns null when there is nothing to measure', () => {
    expect(gatedLoudness([], RATE)).toBeNull()
    expect(gatedLoudness([new Float32Array(RATE)], RATE)).toBeNull()
    // Shorter than one 400 ms block.
    expect(gatedLoudness([sine(0.5, 0.2)], RATE)).toBeNull()
  })
})

/** Stands in for an AnalyserNode: each read returns the next window of a tone. */
function fakeAnalyser(amplitude: number, fftSize = 2048) {
  // A whole number of cycles per window, so every window has the same energy.
  const hz = (RATE * 43) / fftSize
  let offset = 0
  return {
    fftSize,
    getFloatTimeDomainData(out: Float32Array) {
      for (let i = 0; i < out.length; i++) {
        out[i] = amplitude * Math.sin((2 * Math.PI * hz * (offset + i)) / RATE)
      }
      offset += out.length
    },
  }
}

describe('LoudnessMeter', () => {
  it('agrees with the offline measurement', () => {
    // The live meter corrects whatever the pre-roll measured; if the two
    // disagreed, the level would drift every time a station started.
    const meter = new LoudnessMeter(fakeAnalyser(0.25) as unknown as AnalyserNode)
    for (let i = 0; i < 50; i++) meter.sample()
    expect(meter.lufs).toBeCloseTo(gatedLoudness([sine(0.25, 3)], RATE)!, 1)
  })

  it('counts the seconds it has measured', () => {
    const meter = new LoudnessMeter(fakeAnalyser(0.25) as unknown as AnalyserNode)
    for (let i = 0; i < 30; i++) meter.sample()
    expect(meter.seconds).toBeCloseTo(3)
  })

  it('skips silent reads and starts over on reset', () => {
    const meter = new LoudnessMeter(fakeAnalyser(0) as unknown as AnalyserNode)
    meter.sample()
    expect(meter.lufs).toBeNull()
    expect(meter.seconds).toBe(0)

    const loud = new LoudnessMeter(fakeAnalyser(0.25) as unknown as AnalyserNode)
    loud.sample()
    loud.reset()
    expect(loud.lufs).toBeNull()
  })
})

describe('correctionDb', () => {
  it('moves the measured loudness to the target', () => {
    expect(correctionDb(-20, -16)).toBe(4)
    expect(correctionDb(-10, -16)).toBe(-6)
  })

  it('limits the boost and the cut', () => {
    expect(correctionDb(-50, -16)).toBe(12)
    expect(correctionDb(5, -16)).toBe(-12)
    expect(correctionDb(-50, -16, 6, 3)).toBe(6)
    expect(correctionDb(5, -16, 6, 3)).toBe(-3)
  })
})
