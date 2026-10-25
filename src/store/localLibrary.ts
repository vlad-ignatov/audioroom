import { create } from 'zustand'
import { desktop, playableUrl, type DirFile, type DirListing, type LooseFileEntry, type TrackTags } from '@/lib/desktop'
import type { Station } from '@/types/station'

export type Listing =
  | { status: 'loading' }
  | ({ status: 'ready' } & DirListing)
  | { status: 'error'; message: string }

interface LocalLibraryState {
  /** Folders the user added, in the order they were added. */
  roots: string[]
  /** Single files added on their own, shown after the folders. */
  looseFiles: LooseFileEntry[]
  /** Directory contents read so far this session, keyed by path. */
  listings: Record<string, Listing>
  /** Folders the user has opened; remembered across launches. */
  expanded: Record<string, true>
  /** Tags read so far this session, keyed by file path. */
  tags: Record<string, TrackTags>

  loadRoots: () => Promise<void>
  /** Pick a folder and add it as a root. Resolves to a message for the user, or null on cancel. */
  addFolder: () => Promise<string | null>
  removeRoot: (path: string) => Promise<void>
  /** Pick files and add them on their own. Resolves to a message, or null on cancel. */
  addFiles: () => Promise<string | null>
  removeLooseFile: (path: string) => Promise<void>
  setExpanded: (path: string, open: boolean) => void
  /** Read one directory level, unless it is already loaded or loading; a failed read is tried again. */
  load: (path: string) => Promise<void>
  /**
   * Read again every folder that could not be read. A network share that was
   * asleep, or a drive that was unplugged, may be back.
   */
  retryFailed: () => void
  /** Re-read every directory read so far; the disk may have changed. */
  refresh: () => Promise<void>
  /** Ask for tags of files on screen; batched, and each file asked once. */
  requestTags: (paths: string[]) => void
  /** Read these files' tags again, after they were rewritten. */
  retag: (paths: string[]) => void
}

const EXPANDED_KEY = 'local.expanded'

function loadExpanded(): Record<string, true> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    // Trimmed like the roots are: early builds could store a root as "/x/".
    return Array.isArray(list)
      ? Object.fromEntries(list.map((p) => [String(p).replace(/(.)[\\/]+$/, '$1'), true as const]))
      : {}
  } catch {
    return {}
  }
}

function saveExpanded(expanded: Record<string, true>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(Object.keys(expanded)))
  } catch {
    // Remembering open folders is a convenience.
  }
}

/**
 * Every file seen in a listing, by URL, so the player can turn a track id back
 * into something playable. Kept outside the state: it is an index, not data.
 */
const fileIndex = new Map<string, DirFile>()
/** Each file's album art, from its folder. */
const coverIndex = new Map<string, string>()

/** "CD 1", "CD2", "Disc 2", "Buddha Bar Vol.3 - CD 1 …", "CD Щурците … - 2". */
const DISC_FOLDER = /(^|[^\p{L}])(cd|dis[ck])\s*\d|^cd([^\p{L}]|$)/iu

/**
 * Index a folder's files. Tracks take the folder's art; a disc folder with none
 * takes its album's, since multi-disc albums keep one cover above "CD1" and
 * "CD2". Nothing else borrows: the folder above an ordinary album is an artist
 * or a genre, and its pictures are not that album's cover.
 */
function indexListing(path: string, listing: DirListing, listings: Record<string, Listing>): void {
  const trimmed = path.replace(/[\\/]+$/, '')
  const name = trimmed.split(/[\\/]/).pop() ?? ''
  const parent = DISC_FOLDER.test(name) ? listings[trimmed.replace(/[\\/][^\\/]*$/, '')] : undefined
  const cover = listing.cover ?? (parent?.status === 'ready' ? parent.cover : undefined)
  for (const file of listing.files) {
    fileIndex.set(file.url, file)
    if (cover) coverIndex.set(file.url, playableUrl(cover))
    else coverIndex.delete(file.url)
  }
}

/**
 * Index files that were not found through a listing — single files, queued
 * tracks — so the player can find them: each takes the cover of its folder.
 */
export function indexFiles(files: LooseFileEntry[]): void {
  for (const file of files) {
    fileIndex.set(file.url, file)
    if (file.cover) coverIndex.set(file.url, playableUrl(file.cover))
    else coverIndex.delete(file.url)
  }
}

async function describeLooseFiles(paths: string[]): Promise<LooseFileEntry[]> {
  if (!desktop || paths.length === 0) return []
  const files = await desktop.fileEntries(paths)
  indexFiles(files)
  return files
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Tags requested but not yet asked for, and everything ever asked for. */
const tagQueue: string[] = []
const tagRequested = new Set<string>()
let tagTimer: number | null = null
const TAG_BATCH = 40

export const useLocalLibrary = create<LocalLibraryState>()((set, get) => {
  const flushTags = async () => {
    tagTimer = null
    const bridge = desktop
    if (!bridge) return
    while (tagQueue.length > 0) {
      const batch = tagQueue.splice(0, TAG_BATCH)
      try {
        const result = await bridge.readTags(batch)
        set((st) => {
          const tags = { ...st.tags }
          batch.forEach((path, i) => {
            tags[path] = result[i] ?? {}
          })
          return { tags }
        })
      } catch {
        // Leave them untagged; the file name still shows.
      }
    }
  }

  return {
    roots: [],
    looseFiles: [],
    listings: {},
    expanded: loadExpanded(),
    tags: {},

    loadRoots: async () => {
      if (!desktop) return
      const [roots, loose] = await Promise.all([desktop.folders.list(), desktop.looseFiles.list()])
      set({ roots, looseFiles: await describeLooseFiles(loose) })
    },

    addFolder: async () => {
      if (!desktop) return null
      const picked = await desktop.pickDirectory('Add a music folder')
      if (!picked) return null
      const result = await desktop.folders.add(picked)
      set({ roots: result.folders })
      // The folder may have taken in files that were added on their own.
      if (result.absorbed) set({ looseFiles: await describeLooseFiles(await desktop.looseFiles.list()) })
      get().setExpanded(result.root, true)
      const name = baseName(result.root)
      if (result.status === 'exists') return `${name} is already in the library.`
      if (result.status === 'inside') return `That folder is already in the library, under ${name}.`
      const merged = result.replaced?.length ?? 0
      return merged > 0
        ? `Added ${name}. It includes ${merged === 1 ? baseName(result.replaced![0]!) : `${merged} folders`} already in the library.`
        : `Added ${name}.`
    },

    removeRoot: async (path) => {
      if (!desktop) return
      set({ roots: await desktop.folders.remove(path) })
    },

    addFiles: async () => {
      if (!desktop) return null
      const picked = await desktop.pickAudioPaths()
      if (picked.length === 0) return null
      const result = await desktop.looseFiles.add(picked)
      set({ looseFiles: await describeLooseFiles(result.files) })
      const skipped = [
        result.present > 0 && `${result.present} already added`,
        result.covered > 0 && `${result.covered} already in a library folder`,
      ].filter(Boolean)
      if (result.added === 0) return `Nothing added: ${skipped.join(', ')}.`
      return `Added ${plural(result.added, 'file')}${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}.`
    },

    removeLooseFile: async (path) => {
      if (!desktop) return
      const remaining = await desktop.looseFiles.remove(path)
      set((st) => ({ looseFiles: st.looseFiles.filter((f) => remaining.includes(f.path)) }))
    },

    setExpanded: (path, open) => {
      const expanded = { ...get().expanded }
      if (open) expanded[path] = true
      else delete expanded[path]
      saveExpanded(expanded)
      set({ expanded })
      if (open) void get().load(path)
    },

    load: async (path) => {
      const bridge = desktop
      const existing = get().listings[path]
      if (!bridge || (existing && existing.status !== 'error')) return
      set((st) => ({ listings: { ...st.listings, [path]: { status: 'loading' } } }))
      let listing: Listing
      try {
        const result = await bridge.listDir(path)
        indexListing(path, result, get().listings)
        listing = { status: 'ready', ...result }
      } catch (err) {
        listing = { status: 'error', message: readError(err) }
      }
      set((st) => ({ listings: { ...st.listings, [path]: listing } }))
    },

    retryFailed: () => {
      for (const [path, listing] of Object.entries(get().listings)) {
        if (listing.status === 'error') void get().load(path)
      }
    },

    refresh: async () => {
      const bridge = desktop
      if (!bridge) return
      // Parents first, so a disc folder sees its album's fresh cover.
      const paths = Object.keys(get().listings).sort((a, b) => a.length - b.length)
      // Tags too: a retagged file should show its new title.
      tagRequested.clear()
      const results = await Promise.all(
        paths.map(async (path): Promise<[string, Listing]> => {
          try {
            return [path, { status: 'ready', ...(await bridge.listDir(path)) }]
          } catch (err) {
            return [path, { status: 'error', message: readError(err) }]
          }
        }),
      )
      const listings = Object.fromEntries(results)
      for (const [path, listing] of results) {
        if (listing.status === 'ready') indexListing(path, listing, listings)
      }
      set({ listings, tags: {} })
    },

    requestTags: (paths) => {
      for (const path of paths) {
        if (tagRequested.has(path)) continue
        tagRequested.add(path)
        tagQueue.push(path)
      }
      // A short delay lets a fast scroll settle into one batch.
      if (tagQueue.length > 0 && tagTimer === null) {
        tagTimer = window.setTimeout(() => void flushTags(), 60)
      }
    },

    retag: (paths) => {
      // The old tags stay on screen until the new ones arrive, so rows do not
      // flash back to file names.
      for (const path of paths) tagRequested.delete(path)
      get().requestTags(paths)
    },
  }
})

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

function readError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  if (/ENOENT/.test(text)) return 'Folder not found'
  if (/EACCES|EPERM/.test(text)) return 'Permission denied'
  // Electron prefixes IPC errors with the channel; the tail is what matters.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** A file's title for display: its tag, or its name without the extension. */
export function trackTitle(file: DirFile, tags?: TrackTags): string {
  return tags?.title ?? file.name.replace(/\.[^.]+$/, '')
}

/**
 * The player works on stations, so a track is presented as one.
 *
 * Cached per file and tags object: the player bar selects this from the store,
 * and a fresh object on every call would re-render it forever.
 */
const stationCache = new Map<string, { tags: TrackTags | undefined; cover: string | undefined; station: Station }>()

export function trackStation(file: DirFile, tags?: TrackTags): Station {
  const cover = coverIndex.get(file.url)
  const cached = stationCache.get(file.url)
  if (cached && cached.tags === tags && cached.cover === cover) return cached.station
  const title = trackTitle(file, tags)
  const station: Station = {
    id: file.url,
    name: tags?.artist && tags.title ? `${tags.artist} — ${title}` : title,
    url: file.url,
    codec: tags?.codec,
    bitrate: tags?.bitrate,
    duration: tags?.duration,
    album: tags?.album,
    // The player bar and the OS media controls show a station's logo; for a
    // track, its album art takes that place.
    favicon: cover,
    tags: [],
    isHls: false,
    favorite: false,
    addedAt: 0,
    playCount: 0,
    // Nothing to probe: the main process serves the file CORS-clean.
    capability: 'full',
    capabilityCheckedAt: Date.now(),
  }
  stationCache.set(file.url, { tags, cover, station })
  return station
}

/** The track with this id (its `file://` URL), if its folder has been read. */
export function findLocalTrack(id: string, state = useLocalLibrary.getState()): Station | undefined {
  const file = fileIndex.get(id)
  return file ? trackStation(file, state.tags[file.path]) : undefined
}
