// Network shares and removable drives that come back under another name.
//
// macOS mounts a share at /Volumes/<name>. When the server sleeps or the
// network drops, the mount can go stale rather than away, and reconnecting
// from Finder then mounts the same share at /Volumes/<name>-1. Finder shows
// it as before; every path the app saved still says /Volumes/<name>.
//
// So paths keep the name they were saved under, and are resolved to wherever
// the volume is now each time the disk is touched. Async throughout: a stale
// network mount can take a long time to answer, and the main thread must not
// wait on it.

const fs = require('node:fs')

const VOLUME_PATH = /^\/Volumes\/([^/]+)(\/.*)?$/

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function exists(p) {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}

/** Where a saved path is on disk now: itself, or the same path on a renamed mount. */
async function onDisk(p) {
  if (process.platform !== 'darwin') return p
  const match = VOLUME_PATH.exec(p)
  if (!match || (await exists(p))) return p
  const [, volume, rest = ''] = match
  let names
  try {
    names = await fs.promises.readdir('/Volumes')
  } catch {
    return p
  }
  const renamed = new RegExp(`^${escapeRegExp(volume)}-\\d+$`)
  for (const name of names.filter((n) => renamed.test(n)).sort()) {
    const candidate = `/Volumes/${name}${rest}`
    if (await exists(candidate)) return candidate
  }
  return p
}

/** A path found under `real` (where `saved` is now), named as it was saved. */
function asSaved(found, saved, real) {
  return real !== saved && found.startsWith(real) ? saved + found.slice(real.length) : found
}

module.exports = { onDisk, asSaved }
