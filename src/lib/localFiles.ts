import type { Station } from '@/types/station'
import { desktop, type LocalFileEntry } from '@/lib/desktop'
import { useLibrary } from '@/store/library'
import { uid } from './utils'

function stationFromFile(entry: LocalFileEntry): Station {
  return {
    id: uid(),
    name: entry.name,
    url: entry.url,
    codec: entry.codec,
    bitrate: entry.bitrate,
    duration: entry.duration,
    album: entry.album,
    tags: [],
    isHls: false,
    favorite: false,
    addedAt: Date.now(),
    playCount: 0,
    // Nothing to probe: the main process serves the file CORS-clean.
    capability: 'full',
    capabilityCheckedAt: Date.now(),
  }
}

/**
 * Let the user pick audio files and add them to the library.
 *
 * Shared by the toolbar button and the File menu so both behave identically.
 * Resolves quietly when there is no desktop bridge (the browser build) or the
 * picker was cancelled.
 */
export async function addLocalFiles(notify: (message: string) => void): Promise<void> {
  if (!desktop) return
  const entries = await desktop.pickAudioFiles()
  if (entries.length === 0) return
  const added = useLibrary.getState().addStations(entries.map(stationFromFile))
  notify(
    added === entries.length
      ? `Added ${added} file${added === 1 ? '' : 's'}.`
      : `Added ${added}, skipped ${entries.length - added} already in the library.`,
  )
}

/** `m:ss`, or `h:mm:ss` past the hour. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}
