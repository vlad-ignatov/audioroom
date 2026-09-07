import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { engine } from '@/audio/engine'
import { DEFAULT_TARGET_LUFS } from '@/audio/loudness'

/** Presets rather than a free slider: the number means little to most people. */
export const TARGETS = [
  { value: -14, label: 'Loud', hint: '−14 LUFS, matches most streaming services' },
  { value: -16, label: 'Standard', hint: '−16 LUFS, typical for internet radio' },
  { value: -20, label: 'Quiet', hint: '−20 LUFS, more headroom and dynamics' },
] as const

interface LevelingState {
  enabled: boolean
  target: number
  setEnabled: (v: boolean) => void
  setTarget: (lufs: number) => void
}

export const useLeveling = create<LevelingState>()(
  persist(
    (set) => ({
      // On by default: the inconsistency between stations is the problem being
      // solved, and a fix nobody enables is no fix.
      enabled: true,
      target: DEFAULT_TARGET_LUFS,

      setEnabled: (v) => {
        engine.setLevelingEnabled(v)
        set({ enabled: v })
      },
      setTarget: (lufs) => {
        engine.setLevelingTarget(lufs)
        set({ target: lufs })
      },
    }),
    {
      name: 'player.leveling',
      version: 1,
      onRehydrateStorage: () => (state) => {
        // The engine is constructed before this store rehydrates, so push the
        // restored settings into it once they are known.
        if (!state) return
        engine.setLevelingEnabled(state.enabled)
        engine.setLevelingTarget(state.target)
      },
    },
  ),
)
