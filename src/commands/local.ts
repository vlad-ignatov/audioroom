import { desktop, type DirFile } from '@/lib/desktop'
import { trackStation, useLocalLibrary } from '@/store/localLibrary'
import { usePlayer } from '@/store/player'
import { useUi } from '@/store/ui'
import { defineCommands } from './registry'
import { isLive } from './app'

declare module './registry' {
  interface CommandArgs {
    /** `queue`: the ids next/previous should follow from here, in order. */
    'track.play': { file: DirFile; queue: string[] }
    'track.editInfo': { file: DirFile }
    'file.reveal': { path: string }
    'folder.editInfo': { path: string }
    'folder.fixEncoding': { path: string }
    'library.addFiles': void
    'library.addFolder': void
    'library.refresh': void
    'library.removeFolder': { path: string }
    'library.removeFile': { path: string }
  }
}

const notify = (message: string | null) => message && useUi.getState().notify(message)

const isMac = desktop?.platform === 'darwin'

defineCommands({
  'track.play': {
    label: ({ file }) => (usePlayer.getState().currentId === file.url && isLive() ? 'Pause' : 'Play'),
    keys: ['Enter'],
    run: ({ file, queue }) => {
      const player = usePlayer.getState()
      player.setQueue(queue)
      return player.toggle(trackStation(file, useLocalLibrary.getState().tags[file.path]))
    },
  },
  'track.editInfo': {
    label: 'Edit info…',
    keys: ['F2'],
    run: ({ file }) => useUi.getState().setTagEditor(file),
  },
  'file.reveal': {
    label: isMac ? 'Show in Finder' : 'Show in folder',
    enabled: () => !!desktop,
    run: ({ path }) => desktop?.revealFile(path),
  },
  'folder.editInfo': { label: 'Edit info…', run: ({ path }) => useUi.getState().setFolderTags(path) },
  'folder.fixEncoding': { label: 'Fix encoding…', run: ({ path }) => useUi.getState().setEncodingFix(path) },
  'library.addFiles': {
    label: 'Add files…',
    run: () => {
      useUi.getState().setView('local')
      return useLocalLibrary.getState().addFiles().then(notify)
    },
  },
  'library.addFolder': {
    label: 'Add folder…',
    run: () => {
      useUi.getState().setView('local')
      return useLocalLibrary.getState().addFolder().then(notify)
    },
  },
  'library.refresh': {
    label: 'Refresh',
    enabled: () => useLocalLibrary.getState().roots.length > 0,
    run: () => useLocalLibrary.getState().refresh(),
  },
  'library.removeFolder': {
    label: 'Remove from library',
    run: ({ path }) => useLocalLibrary.getState().removeRoot(path),
  },
  'library.removeFile': {
    label: 'Remove from library',
    run: ({ path }) => useLocalLibrary.getState().removeLooseFile(path),
  },
})
