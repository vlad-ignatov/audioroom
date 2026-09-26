/**
 * Typed access to the Electron preload bridge.
 *
 * The app is a desktop app, but it still runs in a plain browser during
 * development, so every caller must tolerate `desktop` being absent.
 */

import type { Station } from '@/types/station'

export type MediaKeyAction = 'toggle' | 'next' | 'previous' | 'stop'

export type MenuCommand =
  | 'toggle'
  | 'next'
  | 'previous'
  | 'volume-up'
  | 'volume-down'
  | 'mute'
  | 'stop'
  | 'toggle-equalizer'
  | 'open-directory'
  | 'add-station'
  | 'add-files'

/** A file the user picked, described by the main process from its tags. */
export interface LocalFileEntry {
  /** `file://` URL; the library stores this, the engine plays it via `media://`. */
  url: string
  name: string
  album?: string
  codec?: string
  /** kbps */
  bitrate?: number
  /** seconds */
  duration?: number
}

/** One atomic batch of library changes; see electron/library-db.cjs. */
export interface LibraryWrite {
  /** Delete every row first; used when the library is replaced wholesale. */
  reset?: boolean
  /** Rows to insert, or overwrite entirely including position. */
  upsert?: { station: Station; position: number }[]
  /** Existing rows whose content changed; their position stays. */
  update?: Station[]
  remove?: string[]
  reposition?: { id: string; position: number }[]
}

export interface DesktopBridge {
  isDesktop: true
  platform: NodeJS.Platform
  versions: { electron: string; chrome: string }
  onMediaKey(fn: (action: MediaKeyAction) => void): () => void
  onMenuCommand(fn: (command: MenuCommand) => void): () => void
  setNowPlaying(text: string): void
  pickAudioFiles(): Promise<LocalFileEntry[]>
  filesExist(urls: string[]): Promise<boolean[]>
  pickFolder(title: string): Promise<string | null>
  library: {
    /**
     * `initialized` is false until the first write ever made; `nextPosition`
     * is the first position after every stored row.
     */
    load(): Promise<{ initialized: boolean; stations: Station[]; nextPosition: number }>
    write(ops: LibraryWrite): Promise<void>
  }
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}

export const desktop: DesktopBridge | undefined =
  typeof window === 'undefined' ? undefined : window.desktop

/**
 * True when running inside the Electron shell.
 *
 * Used to skip the browser workarounds — the CORS probe, the https upgrade —
 * that the main process has already made unnecessary.
 */
export const isDesktop = desktop?.isDesktop === true

/** Whether a station URL points at a file on this machine. */
export function isLocalFile(url: string): boolean {
  return /^file:/i.test(url)
}

/**
 * The URL the media element can actually load.
 *
 * Local files are stored as `file://` URLs — portable, exportable, and what
 * every other tool understands — but the renderer's origin may not read the
 * disk directly, so the main process serves them under a private scheme:
 * `file:///Users/x/a.mp3` becomes `media://local/Users/x/a.mp3`. The `local`
 * host is there because the scheme parses like http, where a URL with no host
 * would swallow the first path segment as one.
 */
export function playableUrl(url: string): string {
  return isLocalFile(url) ? url.replace(/^file:\/\/(localhost)?\//i, 'media://local/') : url
}
