import { useEffect } from 'react'
import { desktop, type MediaKeyAction } from '@/lib/desktop'
import { usePlayer } from '@/store/player'
import { useLocalLibrary } from '@/store/localLibrary'
import { findPlayable } from '@/lib/playable'
import { getCommand, runRef, type CommandId } from '@/commands/registry'

const MEDIA_KEYS: Record<MediaKeyAction, CommandId> = {
  toggle: 'playback.toggle',
  next: 'playback.next',
  previous: 'playback.previous',
  stop: 'playback.stop',
}

/**
 * Wire the native menu and hardware media keys to commands.
 *
 * Both arrive from the main process and run here rather than in a component,
 * so they work whatever is focused or open.
 */
export function useDesktopIntegration(): void {
  useEffect(() => {
    if (!desktop) return
    const offMenu = desktop.onMenuCommand((id) => {
      if (getCommand(id)) runRef({ id: id as CommandId, args: undefined })
      else console.warn(`[menu] unknown command ${id}`)
    })
    const offMedia = desktop.onMediaKey((action) => {
      const id = MEDIA_KEYS[action]
      if (id) runRef({ id, args: undefined })
    })
    return () => {
      offMenu()
      offMedia()
    }
  }, [])

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
