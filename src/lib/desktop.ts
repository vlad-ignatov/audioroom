/**
 * Typed access to the Electron preload bridge.
 *
 * The app is a desktop app, but it still runs in a plain browser during
 * development, so every caller must tolerate `desktop` being absent.
 */

import type { Station } from '@/types/station'

export type MediaKeyAction = 'toggle' | 'next' | 'previous' | 'stop'

/** A command id from the renderer's registry (src/commands), sent by the menu bar. */
export type MenuCommand = string

/** A subfolder in a directory listing. */
export interface DirFolder {
  name: string
  path: string
}

/** An audio file in a directory listing. */
export interface DirFile {
  name: string
  path: string
  /** `file://` URL; doubles as the track's id in the player. */
  url: string
}

export interface DirListing {
  folders: DirFolder[]
  files: DirFile[]
  /** `file://` URL of the folder's album art, when it has any. */
  cover?: string
}

/** What a file's tags offered; every field is best-effort. */
export interface TrackTags {
  title?: string
  artist?: string
  album?: string
  /** seconds */
  duration?: number
  codec?: string
  /** kbps */
  bitrate?: number
}

/** Tag changes for one file: undefined leaves a field alone, '' removes it. */
export interface TagEdit {
  title?: string
  artist?: string
  album?: string
}

/** A file's text tags as found by a folder scan. */
export interface ScannedTags {
  path: string
  title?: string
  artist?: string
  album?: string
}

/** What adding a root folder did; roots never overlap. */
export interface FolderAddResult {
  folders: string[]
  /** `exists`: already a root. `inside`: covered by `root`. */
  status: 'added' | 'exists' | 'inside'
  root: string
  /** Former roots inside the added folder, now shown under it. */
  replaced?: string[]
  /** How many single files the folder took in. */
  absorbed?: number
}

/** A single file in the local library, described like a listing entry. */
export interface LooseFileEntry extends DirFile {
  /** `file://` URL of the cover in the file's folder, if any. */
  cover?: string
  /** Not on disk when last looked; only when asked to keep missing files. */
  missing?: true
}

export interface LooseFilesAddResult {
  files: string[]
  added: number
  /** Already added on their own. */
  present: number
  /** Inside a root folder already. */
  covered: number
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

/** One line of a context menu, as sent to the main process to draw. */
export type ContextMenuItem =
  | { type: 'separator' }
  | { type: 'role'; role: 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo' }
  | {
      type: 'normal' | 'checkbox'
      /** Handed back when this item is chosen. */
      id: number
      label: string
      enabled: boolean
      checked?: boolean
      /** Electron accelerator syntax; shown only. */
      accelerator?: string
    }

export interface DesktopBridge {
  isDesktop: true
  platform: NodeJS.Platform
  versions: { electron: string; chrome: string }
  onMediaKey(fn: (action: MediaKeyAction) => void): () => void
  onMenuCommand(fn: (command: MenuCommand) => void): () => void
  setNowPlaying(text: string): void
  filesExist(urls: string[]): Promise<boolean[]>
  pickFolder(title: string): Promise<string | null>
  pickDirectory(title: string): Promise<string | null>
  listDir(path: string): Promise<DirListing>
  readTags(paths: string[]): Promise<TrackTags[]>
  writeTags(path: string, fields: TagEdit): Promise<void>
  scanTags(
    path: string,
    onProgress?: (p: { done: number; total: number }) => void,
    recursive?: boolean,
  ): Promise<ScannedTags[]>
  pickAudioPaths(): Promise<string[]>
  fileEntries(paths: string[], keepMissing?: boolean): Promise<LooseFileEntry[]>
  /**
   * The audio files among these paths, folders walked depth first in tree
   * order, stopping at `limit`. Paths in `skip` are left out and not counted.
   */
  collectAudio(paths: string[], limit: number, skip?: string[]): Promise<{ paths: string[]; truncated: boolean }>
  /** Pop up a context menu at a point in the page; resolves to the chosen id, or null. */
  showContextMenu(items: ContextMenuItem[], position: { x: number; y: number }): Promise<number | null>
  revealFile(path: string): Promise<void>
  /** The path of a file dropped from the OS. */
  pathForFile(file: File): string
  queue: {
    list(): Promise<string[]>
    set(paths: string[]): Promise<void>
  }
  looseFiles: {
    list(): Promise<string[]>
    add(paths: string[]): Promise<LooseFilesAddResult>
    remove(path: string): Promise<string[]>
  }
  folders: {
    list(): Promise<string[]>
    add(path: string): Promise<FolderAddResult>
    remove(path: string): Promise<string[]>
  }
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
