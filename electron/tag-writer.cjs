// Editing tags in the user's files.
//
// MP3 only for now: it is nearly the whole of a typical older collection, and
// it is where broken tags live — ID3 let taggers store text in whatever
// codepage the machine happened to use and label it Latin-1. Tags are written
// back as ID3v2.3 in UTF-16, which every player reads, and any ID3v1 tag is
// dropped: its fixed-width Latin-1 fields cannot hold the corrected text, and
// players that fall back to it would keep showing the garbage.
//
// Each write goes to a temporary file beside the original and is renamed over
// it, so a disk unplugged mid-write leaves the old file whole, never half of
// each.

const { ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { onDisk, asSaved } = require('./volumes.cjs')

const FIELDS = { title: 'title', artist: 'artist', album: 'album' }

/** The file without its trailing ID3v1 tag (and the rare extended "TAG+" block before it). */
function stripId3v1(buf) {
  let end = buf.length
  if (end >= 128 && buf.toString('latin1', end - 128, end - 125) === 'TAG') end -= 128
  if (end >= 227 && buf.toString('latin1', end - 227, end - 223) === 'TAG+') end -= 227
  return end === buf.length ? buf : buf.subarray(0, end)
}

/**
 * The fields of a trailing ID3v1 tag, as ID3v2 would name them.
 *
 * Dropping the old tag must not lose what only it held — many files ripped in
 * the early 2000s have nothing else. The track number is left behind: in these
 * files it is usually the comment's space padding, read as track 32.
 */
function readId3v1(buf) {
  const end = buf.length
  if (end < 128 || buf.toString('latin1', end - 128, end - 125) !== 'TAG') return {}
  const field = (from, to) => {
    const raw = buf.subarray(end - 128 + from, end - 128 + to)
    const nul = raw.indexOf(0)
    return raw.toString('latin1', 0, nul < 0 ? raw.length : nul).trim()
  }
  const out = {
    title: field(3, 33),
    artist: field(33, 63),
    album: field(63, 93),
    year: field(93, 97),
    // ID3v1.1 ends the comment early to make room for the track byte.
    comment: field(97, buf[end - 3] === 0 ? 125 : 127),
  }
  const genre = buf[end - 1]
  if (genre !== 255) out.genre = `(${genre})`
  for (const key of Object.keys(out)) if (!out[key]) delete out[key]
  if (out.comment) out.comment = { language: 'eng', text: out.comment }
  return out
}

function assertEditable(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.mp3') {
    throw new Error('Only MP3 files can be edited for now.')
  }
}

/**
 * Change some of a file's tags. Fields left undefined are untouched; an empty
 * string removes the field.
 *
 * @param {string} filePath
 * @param {{ title?: string, artist?: string, album?: string }} fields
 */
async function writeTags(savedPath, fields) {
  assertEditable(savedPath)
  const filePath = await onDisk(savedPath)
  const NodeID3 = require('node-id3')
  const original = await fs.promises.readFile(filePath)
  const body = stripId3v1(original)

  // Read, merge, write: every frame node-id3 understands (cover art, comments,
  // lyrics, custom text) is carried over as it was.
  const { raw: _raw, ...current } = NodeID3.read(body)
  const tags = { ...readId3v1(original), ...current }
  for (const [field, key] of Object.entries(FIELDS)) {
    const value = fields[field]
    if (value === undefined) continue
    const clean = String(value).trim()
    if (clean) tags[key] = clean
    else delete tags[key]
  }

  const next = NodeID3.write(tags, body)
  if (!Buffer.isBuffer(next)) throw next instanceof Error ? next : new Error('Could not write the tags.')

  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`)
  try {
    await fs.promises.writeFile(tmp, next)
    await fs.promises.rename(tmp, filePath)
  } catch (err) {
    await fs.promises.rm(tmp, { force: true })
    throw err
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Every MP3 in a folder (and below, if `recursive`), depth first, in file-manager order. */
async function findMp3s(dirPath, recursive, out = []) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  entries.sort((a, b) => collator.compare(a.name, b.name))
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (recursive) await findMp3s(full, recursive, out)
    }
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.mp3') out.push(full)
  }
  return out
}

/**
 * The text tags of every MP3 under a folder, for the renderer to look for
 * broken encodings in. Reports progress, since a whole collection on an
 * external disk takes a while.
 */
async function scanTags(sender, dirPath, recursive = true) {
  const mm = await import('music-metadata')
  const real = await onDisk(dirPath)
  const files = await findMp3s(real, recursive)
  const out = []
  let done = 0
  let lastReport = 0
  for (const filePath of files) {
    try {
      const meta = await mm.parseFile(filePath, { duration: false, skipCovers: true })
      const { title, artist, album } = meta.common
      out.push({ path: asSaved(filePath, dirPath, real), title, artist, album })
    } catch {
      // Unreadable tags: nothing to fix that we could see.
    }
    done++
    const now = Date.now()
    if (now - lastReport > 150 || done === files.length) {
      lastReport = now
      sender.send('tag-scan-progress', { done, total: files.length })
    }
  }
  return out
}

function install() {
  ipcMain.handle('write-tags', (_event, filePath, fields) => writeTags(filePath, fields))
  ipcMain.handle('scan-tags', (event, dirPath, recursive) => scanTags(event.sender, dirPath, recursive))
}

module.exports = { install, writeTags }
