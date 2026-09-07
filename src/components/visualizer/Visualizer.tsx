import { useEffect, useRef } from 'react'
import { engine } from '@/audio/engine'
import { usePlayer } from '@/store/player'
import { cn } from '@/lib/utils'

interface Props {
  /** Number of bars drawn; the strip in the player bar uses fewer. */
  bars?: number
  className?: string
  /** Draw a dim idle baseline instead of nothing when there is no signal. */
  showIdleBaseline?: boolean
}

/**
 * Frequency spectrum drawn straight from the engine's AnalyserNode.
 *
 * FFT bins are linear in frequency, but hearing is not: a linear plot spends
 * three quarters of its width on the 10 kHz–22 kHz range where almost nothing
 * happens. We bucket the bins logarithmically so bass, mids and treble each get
 * a fair share of the display.
 */
export function Visualizer({ bars = 64, className, showIdleBaseline = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pipeline = usePlayer((s) => s.pipeline)
  const status = usePlayer((s) => s.status)
  const live = pipeline === 'graph' && (status === 'playing' || status === 'buffering')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let stopped = false
    const smoothed = new Float32Array(bars)

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const draw = () => {
      if (stopped) return
      raf = requestAnimationFrame(draw)

      const { width, height } = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, width, height)

      const analyser = engine.getAnalyser()
      const buckets = new Float32Array(bars)

      if (analyser && live) {
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
        const nyquist = (analyser.context.sampleRate ?? 48000) / 2
        const minHz = 30
        const maxHz = Math.min(18000, nyquist)
        const logMin = Math.log10(minHz)
        const logMax = Math.log10(maxHz)

        for (let i = 0; i < bars; i++) {
          const loHz = 10 ** (logMin + ((logMax - logMin) * i) / bars)
          const hiHz = 10 ** (logMin + ((logMax - logMin) * (i + 1)) / bars)
          const loBin = Math.floor((loHz / nyquist) * data.length)
          const hiBin = Math.max(loBin + 1, Math.ceil((hiHz / nyquist) * data.length))
          let peak = 0
          for (let b = loBin; b < hiBin && b < data.length; b++) {
            if (data[b]! > peak) peak = data[b]!
          }
          // Tilt the top end up: real programme material rolls off with
          // frequency, and without this the right half looks permanently dead.
          const tilt = 1 + (i / bars) * 0.5
          buckets[i] = Math.min(1, (peak / 255) * tilt)
        }
      }

      const gap = width / bars < 4 ? 1 : 2
      const barWidth = Math.max(1, width / bars - gap)
      const gradient = ctx.createLinearGradient(0, height, 0, 0)
      gradient.addColorStop(0, 'oklch(0.60 0.12 78)')
      gradient.addColorStop(0.65, 'oklch(0.79 0.15 78)')
      gradient.addColorStop(1, 'oklch(0.9 0.1 90)')

      for (let i = 0; i < bars; i++) {
        // Asymmetric smoothing: rise fast so transients read, fall slowly so
        // the display does not flicker.
        const target = buckets[i]!
        const prev = smoothed[i]!
        smoothed[i] = target > prev ? target : prev + (target - prev) * 0.18

        const value = smoothed[i]!
        const x = i * (barWidth + gap)
        const minH = showIdleBaseline ? 1.5 : 0
        const h = Math.max(minH, value * (height - 2))
        ctx.fillStyle = value > 0.01 ? gradient : 'oklch(0.32 0.012 260)'
        ctx.beginPath()
        ctx.roundRect(x, height - h, barWidth, h, Math.min(1.5, barWidth / 2))
        ctx.fill()
      }
    }

    // Never burn frames on a tab nobody is looking at.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
      } else if (!stopped) {
        raf = requestAnimationFrame(draw)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    raf = requestAnimationFrame(draw)

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [bars, live, showIdleBaseline])

  return <canvas ref={canvasRef} className={cn('block h-full w-full', className)} />
}
