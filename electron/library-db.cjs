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

const SCHEMA_VERSION = 1

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

function install() {
  ipcMain.handle('library:load', () => load())
  ipcMain.handle('library:write', (_event, ops) => write(ops))
}

function close() {
  if (!db) return
  db.close()
  db = null
}

module.exports = { install, close }
