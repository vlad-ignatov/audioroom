import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BAND_COUNT, BUILTIN_PRESETS, type EqPreset } from '@/audio/eq'
import { engine } from '@/audio/engine'
import { uid } from '@/lib/utils'

interface EqState {
  enabled: boolean
  /** Whether the EQ drawer is showing; persisted so it survives a reload. */
  panelOpen: boolean
  gains: number[]
  preamp: number
  activePresetId: string | null
  customPresets: EqPreset[]
  setEnabled: (v: boolean) => void
  setPanelOpen: (v: boolean) => void
  setBand: (index: number, db: number) => void
  setPreamp: (db: number) => void
  applyPreset: (id: string) => void
  savePreset: (name: string) => void
  deletePreset: (id: string) => void
  reset: () => void
  allPresets: () => EqPreset[]
}

export const useEq = create<EqState>()(
  persist(
    (set, get) => ({
      enabled: true,
      // Open on first run: the equalizer is the point of the app, and a
      // feature behind a toggle nobody presses may as well not exist.
      panelOpen: true,
      gains: new Array(BAND_COUNT).fill(0),
      preamp: 0,
      activePresetId: 'flat',
      customPresets: [],

      setPanelOpen: (v) => set({ panelOpen: v }),

      setEnabled: (v) => {
        engine.setEqEnabled(v)
        set({ enabled: v })
      },

      setBand: (index, db) => {
        engine.setBandGain(index, db)
        set((st) => {
          const gains = st.gains.slice()
          gains[index] = db
          // Any manual move detaches the selection from its preset.
          return { gains, activePresetId: null }
        })
      },

      setPreamp: (db) => {
        engine.setPreamp(db)
        set({ preamp: db })
      },

      applyPreset: (id) => {
        const preset = get().allPresets().find((p) => p.id === id)
        if (!preset) return
        engine.setAllGains(preset.gains)
        engine.setPreamp(preset.preamp)
        set({ gains: preset.gains.slice(), preamp: preset.preamp, activePresetId: id })
      },

      savePreset: (name) => {
        const { gains, preamp } = get()
        const preset: EqPreset = {
          id: uid(),
          name: name.trim() || 'Untitled preset',
          gains: gains.slice(),
          preamp,
          builtin: false,
        }
        set((st) => ({
          customPresets: [...st.customPresets, preset],
          activePresetId: preset.id,
        }))
      },

      deletePreset: (id) =>
        set((st) => ({
          customPresets: st.customPresets.filter((p) => p.id !== id),
          activePresetId: st.activePresetId === id ? null : st.activePresetId,
        })),

      reset: () => {
        const gains = new Array(BAND_COUNT).fill(0) as number[]
        engine.setAllGains(gains)
        engine.setPreamp(0)
        set({ gains, preamp: 0, activePresetId: 'flat' })
      },

      allPresets: () => [...BUILTIN_PRESETS, ...get().customPresets],
    }),
    {
      name: 'player.eq',
      version: 1,
      partialize: (s) => ({
        enabled: s.enabled,
        panelOpen: s.panelOpen,
        gains: s.gains,
        preamp: s.preamp,
        activePresetId: s.activePresetId,
        customPresets: s.customPresets,
      }),
      // Persisted values must be pushed into the audio graph on rehydrate,
      // otherwise the sliders and the sound disagree after a reload.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        engine.setAllGains(state.gains)
        engine.setPreamp(state.preamp)
        engine.setEqEnabled(state.enabled)
      },
    },
  ),
)
