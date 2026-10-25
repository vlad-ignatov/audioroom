import { desktop, type DirFile } from '@/lib/desktop'
import { trackStation, useLocalLibrary } from '@/store/localLibrary'
import { usePlayQueue, QUEUE_LIMIT } from '@/store/playQueue'
import { usePlayer, type QueueSource } from '@/store/player'
import { useUi } from '@/store/ui'
import { defineCommands } from './registry'
import { isLive } from './app'

declare module './registry' {
  interface CommandArgs {
    /** `queue`: the ids next/previous should follow from here, in order. */
    'track.play': { file: DirFile; source: QueueSource; queue: string[] }
    'track.editInfo': { file: DirFile }
    'tracks.enqueue': { paths: string[] }
    'file.reveal': { path: string }
    'folder.editInfo': { path: string }
    'folder.fixEncoding': { path: string }
    'library.addFiles': void
    'library.addFolder': void
    'library.refresh': void
    'library.removeFolder': { path: string }
    'library.removeFile': { path: string }
    'queue.remove': { path: string }
    'queue.moveToTop': { path: string }
    'queue.moveToBottom': { path: string }
    'queue.shuffle': void
    'queue.clear': void
  }
}

const notify = (message: string | null) => message && useUi.getState().notify(message)

const isMac = desktop?.platform === 'darwin'

defineCommands({
  'track.play': {
    label: ({ file }) => (usePlayer.getState().currentId === file.url && isLive() ? 'Pause' : 'Play'),
    keys: ['Enter'],
    run: ({ file, source, queue }) => {
      const player = usePlayer.getState()
      player.setQueue(queue, source)
      return player.toggle(trackStation(file, useLocalLibrary.getState().tags[file.path]))
    },
  },
  'track.editInfo': {
    label: 'Edit info…',
    keys: ['F2'],
    run: ({ file }) => useUi.getState().setTagEditor(file),
  },
  'tracks.enqueue': {
    label: 'Add to queue',
    enabled: () => usePlayQueue.getState().tracks.length < QUEUE_LIMIT,
    run: ({ paths }) => usePlayQueue.getState().add(paths).then(notify),
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
  'queue.remove': {
    label: 'Remove from queue',
    keys: ['Delete', 'Backspace'],
    run: ({ path }) => usePlayQueue.getState().remove(path),
  },
  'queue.moveToTop': {
    label: 'Move to top',
    enabled: ({ path }) => usePlayQueue.getState().tracks[0]?.path !== path,
    run: ({ path }) => {
      const queue = usePlayQueue.getState()
      queue.move(
        queue.tracks.findIndex((t) => t.path === path),
        0,
      )
    },
  },
  'queue.moveToBottom': {
    label: 'Move to bottom',
    enabled: ({ path }) => usePlayQueue.getState().tracks.at(-1)?.path !== path,
    run: ({ path }) => {
      const queue = usePlayQueue.getState()
      queue.move(
        queue.tracks.findIndex((t) => t.path === path),
        queue.tracks.length,
      )
    },
  },
  'queue.shuffle': {
    label: 'Shuffle',
    enabled: () => usePlayQueue.getState().tracks.length > 1,
    run: () => {
      // The track playing from the queue goes first, so next carries on
      // through the shuffled order instead of jumping into the middle of it.
      const player = usePlayer.getState()
      const playing = player.queueSource === 'queue' ? player.selectedId : null
      usePlayQueue.getState().shuffle(playing)
    },
  },
  'queue.clear': {
    label: 'Clear queue',
    enabled: () => usePlayQueue.getState().tracks.length > 0,
    run: () => usePlayQueue.getState().clear(),
  },
})
