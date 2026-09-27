import type { Station } from '@/types/station'
import { useLibrary } from '@/store/library'
import { findLocalTrack } from '@/store/localLibrary'

/**
 * Whatever an id names: a station in the library, or a track in the local
 * library (whose id is its `file://` URL). The player and its bar go through
 * this so they need not care which view the selection came from.
 */
export function findPlayable(id: string | null | undefined): Station | undefined {
  if (!id) return undefined
  return useLibrary.getState().stations.find((s) => s.id === id) ?? findLocalTrack(id)
}
