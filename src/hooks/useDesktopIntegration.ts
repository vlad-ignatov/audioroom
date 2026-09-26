import { useEffect } from 'react'
import { desktop, type MenuCommand } from '@/lib/desktop'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { useEq } from '@/store/eq'

interface Handlers {
  onOpenDirectory: () => void
  onAddStation: () => void
  onAddFiles: () => void
}

/**
 * Wire the native menu and hardware media keys to the existing stores.
 *
 * Commands arrive from the main process and are handled here rather than in
 * the components so that they work regardless of what is focused or open.
 */
export function useDesktopIntegration({ onOpenDirectory, onAddStation, onAddFiles }: Handlers): void {
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
      }
    }

    const offMenu = desktop.onMenuCommand(run)
    const offMedia = desktop.onMediaKey(run)
    return () => {
      offMenu()
      offMedia()
    }
  }, [onOpenDirectory, onAddStation, onAddFiles])

  // Keep the window title on the current station.
  useEffect(() => {
    const bridge = desktop
    if (!bridge) return
    const apply = () => {
      const { currentId, status } = usePlayer.getState()
      const station = useLibrary.getState().stations.find((s) => s.id === currentId)
      bridge.setNowPlaying(station && status !== 'idle' ? station.name : '')
    }
    apply()
    return usePlayer.subscribe(apply)
  }, [])
}
