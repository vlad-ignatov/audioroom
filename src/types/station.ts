/** How much of the audio pipeline a station's server will actually permit. */
export type Capability =
  /** Not probed yet. */
  | 'unknown'
  /** CORS-clean: routed through Web Audio, so EQ + visualizer work. */
  | 'full'
  /** Plays, but the server forbids Web Audio. No EQ, no visualizer. */
  | 'playback-only'
  /** Cannot be played at all from this origin (mixed content, or dead). */
  | 'unavailable'

export interface Station {
  id: string
  name: string
  /** The URL as supplied by the directory or the user. */
  url: string
  /** Set when we had to rewrite `url` to reach it (e.g. an https:// upgrade). */
  resolvedUrl?: string
  homepage?: string
  favicon?: string
  codec?: string
  bitrate?: number
  country?: string
  countryCode?: string
  language?: string
  tags: string[]
  votes?: number
  isHls: boolean
  /** Track length in seconds; only local files have one. */
  duration?: number
  album?: string
  /** radio-browser stationuuid, absent for hand-added stations. */
  sourceUuid?: string

  // ---- user-owned fields; never overwritten by a directory refresh ----
  favorite: boolean
  color?: string
  notes?: string
  addedAt: number
  lastPlayedAt?: number
  playCount: number

  /**
   * Gated loudness measured while the station played, LUFS.
   *
   * Remembered so levelling is correct from the first second next time rather
   * than settling audibly over the first few.
   */
  loudnessLufs?: number
  loudnessMeasuredAt?: number

  // ---- probe cache ----
  capability: Capability
  capabilityCheckedAt?: number
  /** Why the station is degraded, shown in the UI verbatim. */
  capabilityReason?: string
}

export type NewStation = Pick<Station, 'name' | 'url'> & Partial<Station>
