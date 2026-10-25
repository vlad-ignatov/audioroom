// The data folder, carried over from before the app was renamed.
//
// Electron names the data folder after the product, so renaming Player to
// AudioRoom would start everyone on an empty library while the old folder —
// the SQLite library, settings in Chromium's local storage, window state,
// cached conversions — sat unused beside the new one. On the first launch
// after the rename the old folder is moved into place.
//
// Must run before anything touches userData; the single-instance lock does.

const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OLD_NAME = 'Player'

function migrateDataFolder() {
  const current = app.getPath('userData')
  const old = path.join(app.getPath('appData'), OLD_NAME)
  if (old === current) return
  // Already moved, or used under the new name from the start.
  if (fs.existsSync(path.join(current, 'library.sqlite'))) return
  // "Player" is a generic name: take the folder only if it is clearly ours.
  if (!fs.existsSync(path.join(old, 'library.sqlite'))) return
  try {
    // Replaces `current` if it exists but is empty; fails if it holds anything.
    fs.renameSync(old, current)
  } catch (err) {
    // Locked (an old copy still running, on Windows), or the new folder was
    // already started: keep using the old one rather than an empty library.
    console.warn('[data] could not move', old, 'to', current, err)
    app.setPath('userData', old)
  }
}

module.exports = { migrateDataFolder }
