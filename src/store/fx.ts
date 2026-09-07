import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { engine } from '@/audio/engine'
import { DEFAULT_REVERB, REVERB_PRESETS, type ImpulseOptions } from '@/audio/fx'
import { clamp } from '@/lib/utils'

interface FxState {
  reverbEnabled: boolean
  reverbPresetId: string
  /** Tail length; the preset supplies the initial value, the slider overrides it. */
  seconds: number
  mix: number
  preDelayMs: number

  widthEnabled: boolean
  width: number

  setReverbEnabled: (v: boolean) => void
  applyReverbPreset: (id: string) => void
  setSeconds: (v: number) => void
  commitSeconds: () => void
  setMix: (v: number) => void
  setPreDelay: (v: number) => void

  setWidthEnabled: (v: boolean) => void
  setWidth: (v: number) => void

}

/** Decay shape and early reflections come from the preset; length is live. */
function impulseFor(presetId: string, seconds: number): ImpulseOptions {
  const preset = REVERB_PRESETS.find((p) => p.id === presetId) ?? DEFAULT_REVERB
  return { seconds, decay: preset.decay, damping: preset.damping, early: preset.early }
}

const INITIAL = {
  reverbEnabled: false,
  reverbPresetId: DEFAULT_REVERB.id,
  seconds: DEFAULT_REVERB.seconds,
  mix: DEFAULT_REVERB.mix,
  preDelayMs: DEFAULT_REVERB.preDelayMs,
  widthEnabled: false,
  width: 1,
}

export const useFx = create<FxState>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      setReverbEnabled: (v) => {
        engine.setReverbEnabled(v)
        set({ reverbEnabled: v })
      },

      applyReverbPreset: (id) => {
        const preset = REVERB_PRESETS.find((p) => p.id === id)
        if (!preset) return
        engine.setReverbImpulse(impulseFor(id, preset.seconds))
        engine.setReverbMix(preset.mix)
        engine.setPreDelay(preset.preDelayMs)
        set({
          reverbPresetId: id,
          seconds: preset.seconds,
          mix: preset.mix,
          preDelayMs: preset.preDelayMs,
        })
      },

      // Dragging only moves the label; re-rendering an impulse response on every
      // pointer move would be wasteful, so the buffer is rebuilt on release.
      setSeconds: (v) => set({ seconds: clamp(v, 0.2, 6) }),
      commitSeconds: () => {
        const { reverbPresetId, seconds } = get()
        engine.setReverbImpulse(impulseFor(reverbPresetId, seconds))
      },

      setMix: (v) => {
        const mix = clamp(v, 0, 1)
        engine.setReverbMix(mix)
        set({ mix })
      },

      setPreDelay: (v) => {
        const ms = clamp(v, 0, 120)
        engine.setPreDelay(ms)
        set({ preDelayMs: ms })
      },

      setWidthEnabled: (v) => {
        engine.setWidthEnabled(v)
        set({ widthEnabled: v })
      },

      setWidth: (v) => {
        const width = clamp(v, 0, 2)
        engine.setWidth(width)
        set({ width })
      },
    }),
    {
      name: 'player.fx',
      version: 2,
      partialize: (s) => ({
        reverbEnabled: s.reverbEnabled,
        reverbPresetId: s.reverbPresetId,
        seconds: s.seconds,
        mix: s.mix,
        preDelayMs: s.preDelayMs,
        widthEnabled: s.widthEnabled,
        width: s.width,
      }),
      // v1 also stored 3D placement (azimuth, elevation, orbit). Those controls
      // are gone; drop the dead keys but keep the reverb and width settings the
      // listener already had rather than resetting them.
      migrate: (persisted) => {
        const old = (persisted ?? {}) as Partial<FxState>
        return {
          ...INITIAL,
          reverbEnabled: old.reverbEnabled ?? INITIAL.reverbEnabled,
          reverbPresetId: old.reverbPresetId ?? INITIAL.reverbPresetId,
          seconds: old.seconds ?? INITIAL.seconds,
          mix: old.mix ?? INITIAL.mix,
          preDelayMs: old.preDelayMs ?? INITIAL.preDelayMs,
          widthEnabled: old.widthEnabled ?? INITIAL.widthEnabled,
          width: old.width ?? INITIAL.width,
        } as FxState
      },
      // Persisted settings have to be pushed back into the audio graph, or the
      // controls and the sound disagree after a reload.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        engine.setReverbImpulse(impulseFor(state.reverbPresetId, state.seconds))
        engine.setReverbMix(state.mix)
        engine.setPreDelay(state.preDelayMs)
        engine.setWidth(state.width)
        engine.setReverbEnabled(state.reverbEnabled)
        engine.setWidthEnabled(state.widthEnabled)
      },
    },
  ),
)
