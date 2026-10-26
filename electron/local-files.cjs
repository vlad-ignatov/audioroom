// Local audio files.
//
// The renderer cannot load `file://` media: in development it runs from the
// Vite dev server, whose http:// origin Chromium keeps away from the disk, and
// in production a `file://` page reading arbitrary files is not something to
// rely on either. So files are served through a private `media://` scheme
// instead. The handler supports Range requests, which is what makes seeking
// work — the media element asks for the bytes it needs rather than the file
// from the top — and answers with permissive CORS headers so the file can be
// routed through the Web Audio graph like any radio station.

const { app, protocol, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { Readable } = require('node:stream')
const { pathToFileURL, fileURLToPath } = require('node:url')
const { onDisk } = require('./volumes.cjs')

const run = promisify(execFile)

const SCHEME = 'media'

const AUDIO_EXTENSIONS = [
  'mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'aiff', 'aif', 'caf', 'webm', 'mp4', 'wma',
]

const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.caf': 'audio/x-caf',
  '.webm': 'audio/webm',
  // Album artwork, shown from beside the tracks.
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/** Must run before the app is ready; Chromium reads the list once. */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: true,
      },
    },
  ])
}

/**
 * `media://local/Users/x/song.mp3` → `/Users/x/song.mp3`.
 *
 * The scheme is registered as standard, so it parses like http: a URL with no
 * host would have its first path segment taken for one (and lowercased). The
 * renderer therefore always supplies the `local` host, and the path after it
 * is exactly the path of the `file://` URL the library stores.
 */
function toPath(requestUrl) {
  const url = new URL(requestUrl)
  if (url.host !== 'local') throw new Error(`Unexpected media host: ${url.host}`)
  return fileURLToPath(`file://${url.pathname}`)
}

function parseRange(header, size) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match) return null
  const [, startRaw, endRaw] = match
  if (startRaw === '' && endRaw === '') return null
  if (startRaw === '') {
    // Suffix range: the last N bytes.
    const length = Math.min(Number(endRaw), size)
    return { start: size - length, end: size - 1 }
  }
  const start = Number(startRaw)
  const end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1)
  if (start > end || start >= size) return { invalid: true }
  return { start, end }
}

// ------------------------------------------------------------ transcoding ---
//
// Chromium's media pipeline has no ALAC or WMA decoder and no AIFF, CAF or
// ASF demuxer, so an Apple Lossless rip, an AIFF master or a Windows Media
// file will not play as-is. Files Chromium cannot take are converted once into
// a cache, and the handler serves the conversion in place of the original. The
// renderer never sees the difference: same URL, same seeking, same graph.
//
// The converter is CoreAudio's `afconvert` on macOS for Apple formats, and
// ffmpeg for everything else. ffmpeg is not bundled: it must be installed
// (most Linux systems have it), and without it those files cannot play — the
// listener is told so rather than shown a bare "format not supported". Lossless sources become FLAC, so nothing is lost; lossy WMA becomes
// Opus at a bitrate above the source's, which is transparent without the
// fivefold size of decoding it to FLAC.

/** Containers that may hold something Chromium cannot decode. */
const MAYBE_UNSUPPORTED = new Set(['.m4a', '.mp4', '.aiff', '.aif', '.caf', '.wma'])

/** Per-file verdicts, so the tag parse happens once per play session. */
const codecCache = new Map()
/** In-flight or finished conversions, keyed like the cache file. */
const transcodes = new Map()

function cacheKey(filePath, stat) {
  return crypto
    .createHash('sha1')
    .update(`${filePath}\0${stat.size}\0${stat.mtimeMs}`)
    .digest('hex')
}

/**
 * Whether the file needs converting before Chromium will play it.
 *
 * The extension settles AIFF and CAF; an `.m4a` needs its codec read, since
 * the same container carries AAC (fine) and ALAC (not).
 */
async function needsTranscode(filePath, stat) {
  const ext = path.extname(filePath).toLowerCase()
  if (!MAYBE_UNSUPPORTED.has(ext)) return false
  if (ext !== '.m4a' && ext !== '.mp4') return true

  const key = cacheKey(filePath, stat)
  if (codecCache.has(key)) return codecCache.get(key)
  let verdict = false
  try {
    const mm = await import('music-metadata')
    const meta = await mm.parseFile(filePath, { skipCovers: true })
    verdict = /ALAC/i.test(meta.format.codec ?? '')
  } catch {
    // Unreadable tags do not mean undecodable audio; let Chromium try.
  }
  codecCache.set(key, verdict)
  return verdict
}

/**
 * The path to play for a file: the original, or its cached conversion.
 *
 * A failed conversion falls through to the original, which then fails to
 * decode in the ordinary way, and `problem` says why, for the renderer to show
 * in place of the media element's bare "format not supported".
 *
 * @returns {Promise<{ path: string, problem?: string }>}
 */
async function playablePath(filePath, stat) {
  if (!(await needsTranscode(filePath, stat))) return { path: filePath }
  try {
    return { path: await transcode(filePath, stat) }
  } catch (err) {
    console.warn('[local-files] transcode failed for', filePath, err)
    const problem = err?.missingTool ? err.message : 'Could not convert this file for playback.'
    return { path: filePath, problem }
  }
}

/**
 * Places ffmpeg is installed outside the PATH an app is given.
 *
 * An app opened from the Dock or Finder does not get the shell's PATH, only
 * /usr/bin:/bin:/usr/sbin:/sbin, so Homebrew's and MacPorts' installs are
 * invisible through it. Elsewhere the launcher passes the user's PATH on.
 */
const FFMPEG_LOCATIONS =
  process.platform === 'darwin' ? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/local/bin/ffmpeg'] : []

/** The ffmpeg to run: a known install if there is one, else whatever PATH finds. */
async function findFfmpeg() {
  for (const candidate of FFMPEG_LOCATIONS) {
    try {
      await fs.promises.access(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // Not there.
    }
  }
  return 'ffmpeg'
}

function transcode(filePath, stat) {
  const key = cacheKey(filePath, stat)
  let pending = transcodes.get(key)
  if (!pending) {
    pending = doTranscode(filePath, key).catch((err) => {
      // Do not pin a failure; the next play retries.
      transcodes.delete(key)
      throw err
    })
    transcodes.set(key, pending)
  }
  return pending
}

/**
 * How to convert a file: to FLAC when the source is lossless, to Opus when it
 * is lossy WMA, with a bitrate a little above the source's.
 */
async function conversionFor(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.wma') return { ext: '.flac' }
  try {
    const mm = await import('music-metadata')
    const meta = await mm.parseFile(filePath, { duration: false, skipCovers: true })
    if (meta.format.lossless || /lossless/i.test(meta.format.codec ?? '')) return { ext: '.flac' }
    const sourceKbps = (meta.format.bitrate ?? 192000) / 1000
    return { ext: '.opus', kbps: Math.round(Math.min(256, Math.max(96, sourceKbps * 1.25))) }
  } catch {
    // Unknown codec: FLAC loses nothing whatever it turns out to be.
    return { ext: '.flac' }
  }
}

async function converterArgs(filePath, tmp, conversion) {
  if (process.platform === 'darwin' && conversion.ext === '.flac' && path.extname(filePath).toLowerCase() !== '.wma') {
    return ['afconvert', ['-f', 'flac', '-d', 'flac', filePath, tmp]]
  }
  const codec =
    conversion.ext === '.flac'
      ? ['-c:a', 'flac', '-f', 'flac']
      : ['-c:a', 'libopus', '-b:a', `${conversion.kbps}k`, '-f', 'ogg']
  // First audio stream only: WMA files often carry the cover as a video stream.
  return [await findFfmpeg(), ['-nostdin', '-v', 'error', '-i', filePath, '-map', '0:a:0', ...codec, '-y', tmp]]
}

async function doTranscode(filePath, key) {
  const dir = path.join(app.getPath('userData'), 'transcoded')
  const conversion = await conversionFor(filePath)
  const out = path.join(dir, `${key}${conversion.ext}`)
  try {
    await fs.promises.access(out)
    return out
  } catch {
    // Not converted yet.
  }
  await fs.promises.mkdir(dir, { recursive: true })
  // Write beside the target and rename, so a crash mid-way never leaves a
  // truncated file that looks finished.
  const tmp = `${out}.${process.pid}.tmp`
  try {
    const [tool, args] = await converterArgs(filePath, tmp, conversion)
    try {
      await run(tool, args, { maxBuffer: 16 * 1024 * 1024 })
    } catch (err) {
      if (err?.code === 'ENOENT') {
        const format = path.extname(filePath).slice(1).toUpperCase()
        const missing = new Error(`Playing ${format} files needs ${path.basename(tool)}, which is not installed.`)
        missing.missingTool = true
        throw missing
      }
      throw err
    }
    await fs.promises.rename(tmp, out)
  } catch (err) {
    await fs.promises.rm(tmp, { force: true })
    throw err
  }
  return out
}

// ---------------------------------------------------------------- serving ---

async function serve(request) {
  let filePath
  try {
    // Saved paths may name a share that has since been remounted elsewhere.
    filePath = await onDisk(toPath(request.url))
  } catch {
    return new Response('Bad media URL', { status: 400 })
  }

  let stat
  let problem
  try {
    stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) throw new Error('not a file')
    const source = await playablePath(filePath, stat)
    problem = source.problem
    if (source.path !== filePath) {
      filePath = source.path
      stat = await fs.promises.stat(source.path)
    }
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  }

  // The renderer asks HEAD before playing, to tell a missing file from one
  // that will not decode, and one that could not be converted from both.
  if (request.method === 'HEAD') {
    if (problem) {
      return new Response(null, {
        status: 415,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Unplayable-Reason',
          // Header values are Latin-1 only; the reason is plain text.
          'X-Unplayable-Reason': encodeURIComponent(problem),
        },
      })
    }
    return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(stat.size) } })
  }

  // No byte to read, and a stream over bytes 0 to -1 throws.
  if (stat.size === 0) {
    return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })
  }

  const range = parseRange(request.headers.get('range'), stat.size)
  if (range?.invalid) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${stat.size}` },
    })
  }

  const start = range ? range.start : 0
  const end = range ? range.end : stat.size - 1
  const stream = fs.createReadStream(filePath, { start, end })
  return new Response(Readable.toWeb(stream), {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      'Content-Length': String(end - start + 1),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
    },
  })
}

// ---------------------------------------------------------------- browsing ---
//
// The local library reads the disk lazily: one directory level when a folder
// is expanded, and tags only for the rows on screen. Nothing is cached here or
// in the database — the files are the source of truth, so a rename or a new
// album shows up on the next expand without any rescan.

const AUDIO_SET = new Set(AUDIO_EXTENSIONS)
const IMAGE_SET = new Set(['jpg', 'jpeg', 'png', 'webp'])
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Images that sit with an album but are not its front cover: thumbnails
 * (Windows Media Player's AlbumArtSmall, AlbumArt_{…}_Small), and the rest of a
 * scanned booklet.
 */
const NOT_A_COVER = /small|thumb|back|inlay|inside|tray|booklet|(^|[^a-z])cd([^a-z]|$)|disc/i

/** How much a name says "front cover"; higher wins. */
function coverRank(name) {
  const base = name.replace(/\.[^.]+$/, '').toLowerCase()
  if (/^(front|cover)$/.test(base) || /(^|[^a-z])(front|cover)([^a-z]|$)/.test(base)) return 4
  if (base === 'folder') return 3
  if (/^albumart.*large$/.test(base)) return 2
  return 1
}

/**
 * The folder's album art, if any image in it looks like a front cover.
 *
 * Collections carry the same cover in several copies and sizes — Windows Media
 * Player alone writes four files per album — so pick by name first, then the
 * largest file, which is almost always the largest picture.
 */
async function pickCover(images) {
  const candidates = images.filter((img) => !NOT_A_COVER.test(img.name))
  if (candidates.length === 0) return undefined
  const ranked = await Promise.all(
    candidates.map(async (img) => {
      let size = 0
      try {
        size = (await fs.promises.stat(img.path)).size
      } catch {
        // Unreadable: rank it last.
      }
      return { ...img, rank: coverRank(img.name), size }
    }),
  )
  ranked.sort((a, b) => b.rank - a.rank || b.size - a.size)
  return ranked[0].path
}

/**
 * One level of a directory, unsorted: subfolders, audio files and images.
 * Hidden entries are skipped, and symlinks count as what they point at.
 */
async function readLevel(dirPath) {
  // Read wherever the folder is now, but name what is found by the path it
  // was saved under, so the renderer's keys stay the same.
  const real = await onDisk(dirPath)
  const entries = await fs.promises.readdir(real, { withFileTypes: true })
  const folders = []
  const files = []
  const images = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dirPath, entry.name)
    let isDir = entry.isDirectory()
    let isFile = entry.isFile()
    if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.promises.stat(path.join(real, entry.name))
        isDir = stat.isDirectory()
        isFile = stat.isFile()
      } catch {
        continue // dangling link
      }
    }
    if (isDir) {
      folders.push({ name: entry.name, path: full })
    } else if (isFile) {
      const ext = path.extname(entry.name).slice(1).toLowerCase()
      if (AUDIO_SET.has(ext)) files.push({ name: entry.name, path: full, url: pathToFileURL(full).toString() })
      else if (IMAGE_SET.has(ext)) images.push({ name: entry.name, path: full })
    }
  }
  const byName = (a, b) => collator.compare(a.name, b.name)
  return { folders: folders.sort(byName), files: files.sort(byName), images }
}

/**
 * One level of a directory: its subfolders and its audio files, sorted the way
 * a file manager would ("Disc 2" before "Disc 10").
 */
async function listDir(dirPath) {
  const { folders, files, images } = await readLevel(dirPath)
  // Also for a folder with no tracks of its own: a multi-disc album keeps its
  // cover beside the disc folders, which borrow it (see the renderer).
  const cover = await pickCover(images)
  return { folders, files, cover: cover && pathToFileURL(cover).toString() }
}

/**
 * The audio files among dropped paths, folders walked in the order the tree
 * shows them (subfolders first, then files), up to `limit` files.
 *
 * The walk stops at the limit rather than counting what is left: dropping the
 * root of a large collection must cost a few directory reads, not a scan of
 * the whole disk. Paths in `skip` (already queued) are passed over without
 * counting against the limit.
 *
 * @returns {Promise<{ paths: string[], truncated: boolean }>}
 */
async function collectAudio(paths, limit, skip = []) {
  const skipSet = new Set(skip)
  const found = []
  const taken = new Set()
  /** Real paths of folders entered, so a symlink loop cannot recurse forever. */
  const entered = new Set()
  let truncated = false

  const take = (filePath) => {
    if (skipSet.has(filePath) || taken.has(filePath)) return
    if (found.length >= limit) {
      truncated = true
      return
    }
    taken.add(filePath)
    found.push(filePath)
  }

  const walk = async (dirPath) => {
    let real
    try {
      real = await fs.promises.realpath(await onDisk(dirPath))
    } catch {
      return
    }
    if (entered.has(real)) return
    entered.add(real)
    let level
    try {
      level = await readLevel(dirPath)
    } catch {
      return // unreadable: skip it, keep the rest of the drop
    }
    for (const folder of level.folders) {
      if (truncated) return
      await walk(folder.path)
    }
    for (const file of level.files) {
      if (truncated) return
      take(file.path)
    }
  }

  for (const raw of paths) {
    if (truncated) break
    const p = path.resolve(raw)
    let stat
    try {
      stat = await fs.promises.stat(await onDisk(p))
    } catch {
      continue
    }
    if (stat.isDirectory()) await walk(p)
    else if (stat.isFile() && AUDIO_SET.has(path.extname(p).slice(1).toLowerCase())) take(p)
  }
  return { paths: found, truncated }
}

/**
 * Tags for display in the tree. Skips the full-file duration scan: it runs for
 * every row scrolled into view, so it has to stay cheap, and headers give a
 * duration for nearly every file.
 */
async function readTags(filePath) {
  try {
    const mm = await import('music-metadata')
    const meta = await mm.parseFile(await onDisk(filePath), { duration: false, skipCovers: true })
    const { title, artist, album } = meta.common
    return {
      title: title || undefined,
      artist: artist || undefined,
      album: album || undefined,
      duration: meta.format.duration || undefined,
      codec: codecLabel(meta.format, filePath),
      bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : undefined,
    }
  } catch {
    return { codec: path.extname(filePath).slice(1).toUpperCase() || undefined }
  }
}

/**
 * Describe files added on their own, like a listing's file entries, each with
 * the cover of the folder it sits in. Files no longer on disk are left out,
 * or with `keepMissing` kept and marked, for a list whose drive may just be
 * unmounted.
 */
async function fileEntries(filePaths, keepMissing = false) {
  const covers = new Map()
  const coverOf = async (dir) => {
    if (!covers.has(dir)) {
      let cover
      try {
        const names = await fs.promises.readdir(await onDisk(dir))
        const images = names
          .filter((n) => !n.startsWith('.') && IMAGE_SET.has(path.extname(n).slice(1).toLowerCase()))
          .map((n) => ({ name: n, path: path.join(dir, n) }))
        cover = await pickCover(images)
      } catch {
        // No cover, then.
      }
      covers.set(dir, cover && pathToFileURL(cover).toString())
    }
    return covers.get(dir)
  }
  const out = []
  for (const filePath of filePaths) {
    let exists = false
    try {
      exists = (await fs.promises.stat(await onDisk(filePath))).isFile()
    } catch {
      // Missing.
    }
    if (!exists) {
      if (keepMissing) {
        out.push({ name: path.basename(filePath), path: filePath, url: pathToFileURL(filePath).toString(), missing: true })
      }
      continue
    }
    out.push({
      name: path.basename(filePath),
      path: filePath,
      url: pathToFileURL(filePath).toString(),
      cover: await coverOf(path.dirname(filePath)),
    })
  }
  return out
}

/** Read tags for a batch of files, a few at a time so a big batch cannot hog the disk. */
async function readTagsBatch(paths) {
  const out = new Array(paths.length)
  let next = 0
  const worker = async () => {
    while (next < paths.length) {
      const i = next++
      out[i] = await readTags(paths[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, paths.length) }, worker))
  return out
}

/** Short codec names in the style the directory uses ("MP3", "AAC"). */
function codecLabel(format, filePath) {
  const codec = (format.codec ?? '').toUpperCase()
  const container = (format.container ?? '').toUpperCase()
  if (codec.includes('WINDOWS MEDIA')) return codec.includes('LOSSLESS') ? 'WMA-L' : 'WMA'
  if (codec.includes('MPEG') && codec.includes('LAYER 3')) return 'MP3'
  if (codec.includes('MPEG')) return 'MP3'
  if (codec.includes('FLAC')) return 'FLAC'
  if (codec.includes('ALAC')) return 'ALAC'
  if (codec.includes('AAC')) return 'AAC'
  if (codec.includes('VORBIS')) return 'OGG'
  if (codec.includes('OPUS')) return 'OPUS'
  if (codec.includes('PCM')) {
    if (container.includes('AIFF')) return 'AIFF'
    if (container.includes('WAV')) return 'WAV'
    return 'PCM'
  }
  if (codec) return codec
  return path.extname(filePath).slice(1).toUpperCase() || undefined
}

/**
 * Wire up the protocol and the picker. Call once the app is ready.
 *
 * @param {() => import('electron').BrowserWindow | null} getWindow
 */
function install(getWindow) {
  protocol.handle(SCHEME, serve)

  // For importing a library from another machine, whose files sit elsewhere.
  ipcMain.handle('files-exist', (_event, urls) =>
    urls.map((url) => {
      try {
        return fs.statSync(fileURLToPath(url)).isFile()
      } catch {
        return false
      }
    }),
  )

  /** Resolves to the folder as a `file://` URL ending in `/`, or null on cancel. */
  ipcMain.handle('pick-folder', async (_event, title) => {
    const win = getWindow()
    const options = { title, properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const url = pathToFileURL(result.filePaths[0]).toString()
    return url.endsWith('/') ? url : `${url}/`
  })

  /** Native folder picker for the local library; resolves to a plain path, or null. */
  ipcMain.handle('pick-directory', async (_event, title) => {
    const win = getWindow()
    const options = { title, properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('list-dir', (_event, dirPath) => listDir(dirPath))
  ipcMain.handle('file-entries', (_event, filePaths, keepMissing) => fileEntries(filePaths, keepMissing))
  ipcMain.handle('collect-audio', (_event, paths, limit, skip) => collectAudio(paths, limit, skip))

  /** File picker for the local library; resolves to plain paths, [] on cancel. */
  ipcMain.handle('pick-audio-paths', async () => {
    const win = getWindow()
    const options = {
      title: 'Add audio files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('reveal-file', async (_event, filePath) => shell.showItemInFolder(await onDisk(filePath)))
  ipcMain.handle('read-tags', (_event, paths) => readTagsBatch(paths))
}

module.exports = {
  registerScheme,
  install,
  // For the tests (tests/main), which run without Electron.
  toPath,
  parseRange,
  serve,
  coverRank,
  listDir,
  collectAudio,
}
