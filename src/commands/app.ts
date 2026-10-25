import { usePlayer } from '@/store/player'
import { useEq } from '@/store/eq'
import { useUi } from '@/store/ui'
import { defineCommands } from './registry'

declare module './registry' {
  interface CommandArgs {
    'playback.toggle': void
    'playback.next': void
    'playback.previous': void
    'playback.stop': void
    'volume.up': void
    'volume.down': void
    'volume.mute': void
    'eq.toggle': void
    'eq.reset': void
    'view.radio': void
    'view.local': void
    'filter.focus': void
    'shortcuts.show': void
  }
}

const player = () => usePlayer.getState()

export function isLive(): boolean {
  const { status } = player()
  return status === 'playing' || status === 'buffering' || status === 'connecting'
}

const VOLUME_STEP = 0.05

defineCommands({
  'playback.toggle': {
    label: () => (isLive() ? 'Pause' : 'Play'),
    keys: ['Space'],
    global: true,
    // Acts on the selection, not on what the engine happens to hold, so it
    // still resumes after a pause or a stop.
    run: () => player().togglePlayback(),
  },
  'playback.next': { label: 'Next', keys: ['ArrowRight'], global: true, run: () => player().step(1) },
  'playback.previous': { label: 'Previous', keys: ['ArrowLeft'], global: true, run: () => player().step(-1) },
  'playback.stop': { label: 'Stop', run: () => player().stop() },
  'volume.up': {
    label: 'Volume up',
    keys: ['ArrowUp'],
    global: true,
    run: () => player().setVolume(player().volume + VOLUME_STEP),
  },
  'volume.down': {
    label: 'Volume down',
    keys: ['ArrowDown'],
    global: true,
    run: () => player().setVolume(player().volume - VOLUME_STEP),
  },
  'volume.mute': {
    label: 'Mute',
    keys: ['M'],
    global: true,
    checked: () => player().muted,
    run: () => player().toggleMute(),
  },
  'eq.toggle': {
    label: () => (useEq.getState().panelOpen ? 'Hide equalizer' : 'Show equalizer'),
    keys: ['E'],
    global: true,
    run: () => {
      const eq = useEq.getState()
      eq.setPanelOpen(!eq.panelOpen)
    },
  },
  'eq.reset': { label: 'Reset equalizer', keys: ['0'], global: true, run: () => useEq.getState().reset() },
  'view.radio': { label: 'Internet radio', run: () => useUi.getState().setView('radio') },
  'view.local': { label: 'Local library', run: () => useUi.getState().setView('local') },
  'filter.focus': {
    label: 'Filter',
    keys: ['/'],
    global: true,
    run: () => document.querySelector<HTMLInputElement>('input[type="search"]')?.focus(),
  },
  'shortcuts.show': { label: 'Keyboard shortcuts', run: () => useUi.getState().setShortcutsOpen(true) },
})
