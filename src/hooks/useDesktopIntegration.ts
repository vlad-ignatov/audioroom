import { useEffect } from 'react'
import { desktop, type MenuCommand } from '@/lib/desktop'
import { usePlayer } from '@/store/player'
import { useLocalLibrary } from '@/store/localLibrary'
import { findPlayable } from '@/lib/playable'
import { useEq } from '@/store/eq'

interface Handlers {
  onOpenDirectory: () => void
  onAddStation: () => void
  onAddFiles: () => void
  onAddFolder: () => void
  onShowShortcuts: () => void
  onShowView: (view: 'radio' | 'local') => void
}

/**
 * Wire the native menu and hardware media keys to the existing stores.
 *
 * Commands arrive from the main process and are handled here rather than in
 * the components so that they work regardless of what is focused or open.
 */
export function useDesktopIntegration({
  onOpenDirectory,
  onAddStation,
  onAddFiles,
  onAddFolder,
  onShowShortcuts,
  onShowView,
}: Handlers): void {
  useEffect(() => {
    if (!desktop) return

    const run = (command: MenuCommand) => {
      const player = usePlayer.getState()
      switch (command) {
        case 'toggle':
          void player.togglePlayback()
          break
        case 'next':
          void player.step(1)
          break
        case 'previous':
          void player.step(-1)
          break
        case 'stop':
          player.stop()
          break
        case 'volume-up':
          player.setVolume(player.volume + 0.05)
          break
        case 'volume-down':
          player.setVolume(player.volume - 0.05)
          break
        case 'mute':
          player.toggleMute()
          break
        case 'toggle-equalizer': {
          const eq = useEq.getState()
          eq.setPanelOpen(!eq.panelOpen)
          break
        }
        case 'open-directory':
          onOpenDirectory()
          break
        case 'add-station':
          onAddStation()
          break
        case 'add-files':
          onAddFiles()
          break
        case 'add-folder':
          onAddFolder()
          break
        case 'show-shortcuts':
          onShowShortcuts()
          break
        case 'view-radio':
          onShowView('radio')
          break
        case 'view-local':
          onShowView('local')
          break
      }
    }

    const offMenu = desktop.onMenuCommand(run)
    const offMedia = desktop.onMediaKey(run)
    return () => {
      offMenu()
      offMedia()
    }
  }, [onOpenDirectory, onAddStation, onAddFiles, onAddFolder, onShowShortcuts, onShowView])

  // Keep the window title on the current station.
  useEffect(() => {
    const bridge = desktop
    if (!bridge) return
    const apply = () => {
      const { currentId, status } = usePlayer.getState()
      const station = findPlayable(currentId)
      bridge.setNowPlaying(station && status !== 'idle' ? station.name : '')
    }
    apply()
    const offPlayer = usePlayer.subscribe(apply)
    // A track's title arrives with its tags, after it may have started.
    const offLocal = useLocalLibrary.subscribe(apply)
    return () => {
      offPlayer()
      offLocal()
    }
  }, [])
}
