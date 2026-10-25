// The station library, in SQLite.
//
// localStorage was the web build's only option, and it shows: a few MB per
// origin, and the whole library rewritten as one JSON string on every change,
// down to bumping a play count. Here each station is a row and the renderer
// sends only the rows that changed.
//
// The file lives in userData, outside the app bundle, so it survives updates
// and reinstalls. Each station is stored whole as JSON, next to the columns
// the database itself needs: the renderer holds the library in memory and
// does all sorting and filtering there, so splitting every field into a
// column would buy nothing yet.

const { app, ipcMain } = require('electron')
const path = require('node:path')

/** @type {import('node:sqlite').DatabaseSync | null} */
let db = null

const SCHEMA_VERSION = 5

function open() {
  if (db) return db
  // Required lazily: node:sqlite logs an experimental-feature warning on load,
  // and nothing else in the main process needs it.
  const { DatabaseSync } = require('node:sqlite')
  db = new DatabaseSync(path.join(app.getPath('userData'), 'library.sqlite'))
  // WAL keeps a crash mid-write from corrupting the file and lets reads and
  // the (frequent, tiny) writes overlap.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')

  const version = db.prepare('PRAGMA user_version').get().user_version
  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS stations (
        id       TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        url      TEXT NOT NULL,
        data     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stations_position ON stations(position);
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }
  if (version < 2) {
    // The local library's roots. Only the paths: everything shown under them
    // is read from the disk when it is needed.
    db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        path     TEXT PRIMARY KEY,
        position INTEGER NOT NULL
      );
    `)
  }
  if (version < 3) {
    // Early builds stored whatever the picker returned, so one folder could be
    // in the list twice, with and without a trailing slash.
    const rows = db.prepare('SELECT path FROM folders ORDER BY position, rowid').all()
    const unique = [...new Set(rows.map((r) => normalizeFolder(r.path)))]
    db.exec('DELETE FROM folders')
    const put = db.prepare('INSERT INTO folders (path, position) VALUES (?, ?)')
    unique.forEach((p, i) => put.run(p, i))
  }
  if (version < 4) {
    // Single files added on their own, beside the root folders.
    db.exec(`
      CREATE TABLE IF NOT EXISTS loose_files (
        path     TEXT PRIMARY KEY,
        position INTEGER NOT NULL
      );
    `)
  }
  if (version < 5) {
    // The local library's play queue, in play order.
    db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        position INTEGER PRIMARY KEY,
        path     TEXT NOT NULL
      );
    `)
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  return db
}

function transaction(fn) {
  const conn = open()
  conn.exec('BEGIN')
  try {
    fn(conn)
    conn.exec('COMMIT')
  } catch (err) {
    conn.exec('ROLLBACK')
    throw err
  }
}

/**
 * Everything the renderer needs at startup.
 *
 * `initialized` is false until the first write, which is how the renderer
 * knows to bring over a library from localStorage (or seed a new one) rather
 * than showing an empty list the user never asked for.
 */
function load() {
  const conn = open()
  const initialized = conn.prepare("SELECT 1 FROM meta WHERE key = 'initialized'").get() !== undefined
  const rows = conn.prepare('SELECT data FROM stations ORDER BY position, rowid').all()
  const { next } = conn.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM stations').get()
  return { initialized, stations: rows.map((r) => JSON.parse(r.data)), nextPosition: next }
}

/**
 * Apply one batch of changes atomically.
 *
 * @param {{
 *   reset?: boolean,
 *   upsert?: { station: { id: string, url: string }, position: number }[],
 *   update?: { id: string, url: string }[],
 *   remove?: string[],
 *   reposition?: { id: string, position: number }[],
 * }} ops
 */
function write(ops) {
  transaction((conn) => {
    if (ops.reset) conn.exec('DELETE FROM stations')
    if (ops.remove?.length) {
      const del = conn.prepare('DELETE FROM stations WHERE id = ?')
      for (const id of ops.remove) del.run(id)
    }
    if (ops.upsert?.length) {
      const put = conn.prepare(`
        INSERT INTO stations (id, position, url, data) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET position = excluded.position, url = excluded.url, data = excluded.data
      `)
      for (const { station, position } of ops.upsert) {
        put.run(station.id, position, station.url, JSON.stringify(station))
      }
    }
    if (ops.update?.length) {
      const change = conn.prepare('UPDATE stations SET url = ?, data = ? WHERE id = ?')
      for (const station of ops.update) change.run(station.url, JSON.stringify(station), station.id)
    }
    if (ops.reposition?.length) {
      const move = conn.prepare('UPDATE stations SET position = ? WHERE id = ?')
      for (const { id, position } of ops.reposition) move.run(position, id)
    }
    conn.exec("INSERT OR IGNORE INTO meta (key, value) VALUES ('initialized', '1')")
  })
}

function listFolders() {
  return open()
    .prepare('SELECT path FROM folders ORDER BY position, rowid')
    .all()
    .map((r) => r.path)
}

/** "/a/b/" and "/a/b" are one folder. */
function normalizeFolder(folderPath) {
  return path.resolve(folderPath)
}

function isInside(child, parent) {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Add a root folder, keeping the roots disjoint: the tree shows each root's
 * contents in full, so a folder inside another root would appear twice.
 *
 * A folder already covered is not added (`status` says by which root); one
 * that contains existing roots takes their place.
 */
function addFolder(folderPath) {
  const target = normalizeFolder(folderPath)
  const roots = listFolders()
  const covering = roots.find((root) => root === target || isInside(target, root))
  if (covering) {
    return { folders: roots, status: covering === target ? 'exists' : 'inside', root: covering }
  }
  const replaced = roots.filter((root) => isInside(root, target))
  // Loose files in the new folder now show inside it instead.
  const absorbed = listLooseFiles().filter((file) => isInside(file, target))
  transaction((c) => {
    const del = c.prepare('DELETE FROM folders WHERE path = ?')
    for (const root of replaced) del.run(root)
    const delFile = c.prepare('DELETE FROM loose_files WHERE path = ?')
    for (const file of absorbed) delFile.run(file)
    const { next } = c.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM folders').get()
    c.prepare('INSERT INTO folders (path, position) VALUES (?, ?)').run(target, next)
  })
  return { folders: listFolders(), status: 'added', root: target, replaced, absorbed: absorbed.length }
}

function listLooseFiles() {
  return open()
    .prepare('SELECT path FROM loose_files ORDER BY position, rowid')
    .all()
    .map((r) => r.path)
}

/**
 * Add single files. Like root folders they never overlap: a file already
 * inside a root folder, or already added, is skipped and counted.
 */
function addLooseFiles(filePaths) {
  const roots = listFolders()
  const existing = new Set(listLooseFiles())
  let added = 0
  let present = 0
  let covered = 0
  transaction((c) => {
    let { next } = c.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM loose_files').get()
    const put = c.prepare('INSERT INTO loose_files (path, position) VALUES (?, ?)')
    for (const raw of filePaths) {
      const file = path.resolve(raw)
      if (existing.has(file)) present++
      else if (roots.some((root) => isInside(file, root))) covered++
      else {
        put.run(file, next++)
        existing.add(file)
        added++
      }
    }
  })
  return { files: listLooseFiles(), added, present, covered }
}

function removeLooseFile(filePath) {
  open().prepare('DELETE FROM loose_files WHERE path = ?').run(path.resolve(filePath))
  return listLooseFiles()
}

function removeFolder(folderPath) {
  open().prepare('DELETE FROM folders WHERE path = ?').run(normalizeFolder(folderPath))
  return listFolders()
}

function listQueue() {
  return open()
    .prepare('SELECT path FROM queue ORDER BY position')
    .all()
    .map((r) => r.path)
}

/** Replace the queue. It holds at most a thousand rows, so rewriting it whole is cheap. */
function setQueue(paths) {
  transaction((c) => {
    c.exec('DELETE FROM queue')
    const put = c.prepare('INSERT INTO queue (position, path) VALUES (?, ?)')
    paths.forEach((p, i) => put.run(i, p))
  })
}

function install() {
  ipcMain.handle('library:load', () => load())
  ipcMain.handle('library:write', (_event, ops) => write(ops))
  ipcMain.handle('folders:list', () => listFolders())
  ipcMain.handle('folders:add', (_event, folderPath) => addFolder(folderPath))
  ipcMain.handle('folders:remove', (_event, folderPath) => removeFolder(folderPath))
  ipcMain.handle('loose-files:list', () => listLooseFiles())
  ipcMain.handle('loose-files:add', (_event, filePaths) => addLooseFiles(filePaths))
  ipcMain.handle('loose-files:remove', (_event, filePath) => removeLooseFile(filePath))
  ipcMain.handle('queue:list', () => listQueue())
  ipcMain.handle('queue:set', (_event, paths) => setQueue(paths))
}

function close() {
  if (!db) return
  db.close()
  db = null
}

module.exports = { install, close }
