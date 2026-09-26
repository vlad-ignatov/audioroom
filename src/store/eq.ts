import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BAND_COUNT, BUILTIN_PRESETS, type EqPreset } from '@/audio/eq'
import { engine } from '@/audio/engine'
import { uid } from '@/lib/utils'

/** Preset names are unique ignoring case and surrounding whitespace. */
const nameKey = (name: string) => name.trim().toLocaleLowerCase()

/**
 * Applies a curve edit. Editing a user preset writes straight through to it;
 * editing a built-in (read-only) one detaches the selection to "Custom".
 */
function edit(st: EqState, gains: number[], preamp: number): Partial<EqState> {
  if (!st.customPresets.some((p) => p.id === st.activePresetId)) {
    return { gains, preamp, activePresetId: null }
  }
  return {
    gains,
    preamp,
    customPresets: st.customPresets.map((p) =>
      p.id === st.activePresetId ? { ...p, gains: gains.slice(), preamp } : p,
    ),
  }
}

/**
 * Collapses same-named user presets left over from before names were unique,
 * keeping the active one, otherwise the most recently saved.
 */
function dedupeByName(presets: EqPreset[], activeId: string | null): EqPreset[] {
  const keep = new Map<string, EqPreset>()
  for (const p of presets) {
    const key = nameKey(p.name)
    if (keep.get(key)?.id !== activeId) keep.set(key, p)
  }
  return presets.filter((p) => keep.get(nameKey(p.name)) === p)
}

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
  /** Saves the current curve under `name`, replacing a user preset of the same name. */
  savePreset: (name: string) => void
  findPresetByName: (name: string) => EqPreset | undefined
  /**
   * Bring in presets from another machine. A same-named preset here is
   * overwritten (names are unique); the rest are added. Returns the id each
   * imported preset ended up with.
   */
  mergePresets: (incoming: EqPreset[]) => Map<string, string>
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
          return edit(st, gains, st.preamp)
        })
      },

      setPreamp: (db) => {
        engine.setPreamp(db)
        set((st) => edit(st, st.gains, db))
      },

      applyPreset: (id) => {
        const preset = get().allPresets().find((p) => p.id === id)
        if (!preset) return
        engine.setAllGains(preset.gains)
        engine.setPreamp(preset.preamp)
        set({ gains: preset.gains.slice(), preamp: preset.preamp, activePresetId: id })
      },

      savePreset: (name) => {
        const { gains, preamp, customPresets } = get()
        const trimmed = name.trim() || 'Untitled preset'
        const existing = customPresets.find((p) => nameKey(p.name) === nameKey(trimmed))
        const preset: EqPreset = {
          id: existing?.id ?? uid(),
          name: trimmed,
          gains: gains.slice(),
          preamp,
          builtin: false,
        }
        set({
          customPresets: existing
            ? customPresets.map((p) => (p.id === existing.id ? preset : p))
            : [...customPresets, preset],
          activePresetId: preset.id,
        })
      },

      findPresetByName: (name) =>
        get()
          .allPresets()
          .find((p) => nameKey(p.name) === nameKey(name)),

      mergePresets: (incoming) => {
        const presets = get().customPresets.slice()
        const ids = new Map<string, string>()
        for (const p of incoming) {
          // Built-in names are reserved; the exporting app enforced that too.
          if (BUILTIN_PRESETS.some((b) => nameKey(b.name) === nameKey(p.name))) continue
          const at = presets.findIndex((q) => nameKey(q.name) === nameKey(p.name))
          if (at >= 0) {
            const id = presets[at]!.id
            presets[at] = { ...p, id, builtin: false }
            ids.set(p.id, id)
          } else {
            const id = presets.some((q) => q.id === p.id) ? uid() : p.id
            presets.push({ ...p, id, builtin: false })
            ids.set(p.id, id)
          }
        }
        set({ customPresets: presets })
        // The active preset may just have been overwritten: the sound must follow.
        const active = presets.find((p) => p.id === get().activePresetId)
        if (active) get().applyPreset(active.id)
        return ids
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
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Pick<EqState, 'activePresetId' | 'customPresets'>
        if (version < 2 && Array.isArray(state.customPresets)) {
          state.customPresets = dedupeByName(state.customPresets, state.activePresetId)
        }
        return state as EqState
      },
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
