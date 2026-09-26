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

const { app, protocol, dialog, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { Readable } = require('node:stream')
const { pathToFileURL, fileURLToPath } = require('node:url')

const run = promisify(execFile)

const SCHEME = 'media'

const AUDIO_EXTENSIONS = [
  'mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'aiff', 'aif', 'caf', 'webm', 'mp4',
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
// Chromium's media pipeline has no ALAC decoder and no AIFF or CAF demuxer,
// so an Apple Lossless rip or an AIFF master will not play as-is. macOS has
// CoreAudio, which reads all of them, and exposes it as `afconvert`. So files
// Chromium cannot take are converted once — losslessly, to FLAC — into a
// cache, and the handler serves the conversion in place of the original. The
// renderer never sees the difference: same URL, same seeking, same graph.

/** Containers that may hold something Chromium cannot decode. */
const MAYBE_UNSUPPORTED = new Set(['.m4a', '.mp4', '.aiff', '.aif', '.caf'])

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
 * Conversion failures fall through to the original so the renderer reports
 * the ordinary "format not supported" rather than something opaque.
 */
async function playablePath(filePath, stat) {
  if (!(await needsTranscode(filePath, stat))) return filePath
  try {
    return await transcode(filePath, stat)
  } catch (err) {
    console.warn('[local-files] transcode failed for', filePath, err)
    return filePath
  }
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

async function doTranscode(filePath, key) {
  const dir = path.join(app.getPath('userData'), 'transcoded')
  const out = path.join(dir, `${key}.flac`)
  try {
    await fs.promises.access(out)
    return out
  } catch {
    // Not converted yet.
  }
  if (process.platform !== 'darwin') {
    throw new Error('No converter available on this platform.')
  }
  await fs.promises.mkdir(dir, { recursive: true })
  // Write beside the target and rename, so a crash mid-way never leaves a
  // truncated file that looks finished.
  const tmp = `${out}.${process.pid}.tmp`
  try {
    await run('afconvert', ['-f', 'flac', '-d', 'flac', filePath, tmp])
    await fs.promises.rename(tmp, out)
  } catch (err) {
    await fs.promises.rm(tmp, { force: true })
    throw err
  }
  return out
}

/**
 * Start converting a file the moment it is added, off the play path.
 *
 * Fire-and-forget: if it is still running when play is pressed, the handler
 * simply waits on the same promise.
 */
async function warmTranscode(filePath) {
  try {
    const stat = await fs.promises.stat(filePath)
    if (await needsTranscode(filePath, stat)) await transcode(filePath, stat)
  } catch (err) {
    console.warn('[local-files] pre-conversion failed for', filePath, err)
  }
}

// ---------------------------------------------------------------- serving ---

async function serve(request) {
  let filePath
  try {
    filePath = toPath(request.url)
  } catch {
    return new Response('Bad media URL', { status: 400 })
  }

  let stat
  try {
    stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) throw new Error('not a file')
    const source = await playablePath(filePath, stat)
    if (source !== filePath) {
      filePath = source
      stat = await fs.promises.stat(source)
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
  // that will not decode.
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(stat.size) } })
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

/**
 * What the library needs to know about a file, read from its tags.
 *
 * Everything but `url` and `name` is best-effort: an untagged file is still a
 * perfectly good track and lands with its filename as the name.
 */
async function describe(filePath) {
  const url = pathToFileURL(filePath).toString()
  const base = path.basename(filePath, path.extname(filePath))
  const entry = { url, name: base }
  try {
    const mm = await import('music-metadata')
    const meta = await mm.parseFile(filePath, { duration: true, skipCovers: true })
    const { title, artist, album } = meta.common
    if (title) entry.name = artist ? `${artist} — ${title}` : title
    if (album) entry.album = album
    entry.codec = codecLabel(meta.format, filePath)
    if (meta.format.bitrate) entry.bitrate = Math.round(meta.format.bitrate / 1000)
    if (meta.format.duration) entry.duration = meta.format.duration
  } catch (err) {
    console.warn('[local-files] could not read tags for', filePath, err)
    entry.codec = path.extname(filePath).slice(1).toUpperCase() || undefined
  }
  void warmTranscode(filePath)
  return entry
}

/** Short codec names in the style the directory uses ("MP3", "AAC"). */
function codecLabel(format, filePath) {
  const codec = (format.codec ?? '').toUpperCase()
  const container = (format.container ?? '').toUpperCase()
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

  ipcMain.handle('pick-audio-files', async () => {
    const win = getWindow()
    const options = {
      title: 'Add audio files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return Promise.all(result.filePaths.map(describe))
  })

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
}

module.exports = { registerScheme, install }
