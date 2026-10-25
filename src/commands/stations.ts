import type { Station } from '@/types/station'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useUi } from '@/store/ui'
import { defineCommands } from './registry'
import { isLive } from './app'

declare module './registry' {
  interface CommandArgs {
    /** `queue`: the station ids next/previous should follow, as listed. */
    'station.play': { station: Station; queue: string[] }
    'station.favorite': { station: Station }
    'station.edit': { station: Station }
    'station.copyUrl': { station: Station }
    'station.remove': { station: Station }
    'station.add': void
    'stations.browse': void
  }
}

/** The library's copy, which may be newer than the one a row rendered with. */
const current = (station: Station) => useLibrary.getState().stations.find((s) => s.id === station.id) ?? station

defineCommands({
  'station.play': {
    label: ({ station }) => (usePlayer.getState().currentId === station.id && isLive() ? 'Pause' : 'Play'),
    // Space too: on a focused row it plays that row; elsewhere it is play/pause.
    keys: ['Enter', 'Space'],
    run: ({ station, queue }) => {
      const player = usePlayer.getState()
      player.setQueue(queue, 'stations')
      return player.toggle(current(station))
    },
  },
  'station.favorite': {
    label: 'Favourite',
    checked: ({ station }) => current(station).favorite,
    run: ({ station }) => useLibrary.getState().toggleFavorite(station.id),
  },
  'station.edit': { label: 'Edit…', run: ({ station }) => useUi.getState().editStation(current(station)) },
  'station.copyUrl': {
    label: 'Copy stream URL',
    run: async ({ station }) => {
      await navigator.clipboard.writeText(current(station).url)
      useUi.getState().notify('Stream URL copied.')
    },
  },
  'station.remove': {
    label: 'Remove from library',
    run: ({ station }) => useLibrary.getState().removeStation(station.id),
  },
  'station.add': { label: 'Add station…', run: () => useUi.getState().editStation(null) },
  'stations.browse': { label: 'Browse stations…', keys: ['B'], global: true, run: () => useUi.getState().setDirectoryOpen(true) },
})
