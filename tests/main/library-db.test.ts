import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import db from '../../electron/library-db.cjs'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audioroom-db-'))
  file = path.join(dir, 'library.sqlite')
})

afterEach(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const station = (id: string, extra: object = {}) => ({ id, url: `http://radio.example/${id}`, name: id, ...extra })

describe('migrations', () => {
  it('creates every table in a new database', () => {
    const conn = db.open(file)
    const tables = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name)
    expect(tables).toEqual(['folders', 'loose_files', 'meta', 'queue', 'settings', 'stations'])
    expect(conn.prepare('PRAGMA user_version').get()?.user_version).toBe(db.SCHEMA_VERSION)
  })

  it('upgrades a version 2 database and keeps its data', () => {
    // The schema as version 2 left it, with the duplicate folders early
    // builds could save.
    const old = new DatabaseSync(file)
    old.exec(`
      CREATE TABLE stations (id TEXT PRIMARY KEY, position INTEGER NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE folders (path TEXT PRIMARY KEY, position INTEGER NOT NULL);
      PRAGMA user_version = 2;
    `)
    const music = path.join(dir, 'Music')
    old.prepare('INSERT INTO folders VALUES (?, ?)').run(music + path.sep, 0)
    old.prepare('INSERT INTO folders VALUES (?, ?)').run(music, 1)
    old.prepare('INSERT INTO stations VALUES (?, ?, ?, ?)').run('a', 0, 'http://a/', JSON.stringify(station('a')))
    old.prepare("INSERT INTO meta VALUES ('initialized', '1')").run()
    old.close()

    db.open(file)
    expect(db.listFolders()).toEqual([music])
    expect(db.load()).toMatchObject({ initialized: true, stations: [station('a')] })
    expect(db.listQueue()).toEqual([])
    expect(db.loadSettings()).toEqual({})
  })
})

describe('stations', () => {
  beforeEach(() => {
    db.open(file)
  })

  it('reports a new library as not yet initialized', () => {
    expect(db.load()).toEqual({ initialized: false, stations: [], nextPosition: 0 })
  })

  it('keeps stations in position order', () => {
    db.write({
      upsert: [
        { station: station('b'), position: 1 },
        { station: station('a'), position: 0 },
        { station: station('c'), position: 2 },
      ],
    })
    expect(db.load()).toMatchObject({ initialized: true, nextPosition: 3 })
    expect(db.load().stations.map((s: { id: string }) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('updates, removes and repositions in one batch', () => {
    db.write({ upsert: ['a', 'b', 'c'].map((id, position) => ({ station: station(id), position })) })
    db.write({
      update: [station('a', { name: 'Renamed' })],
      remove: ['b'],
      reposition: [
        { id: 'c', position: 0 },
        { id: 'a', position: 1 },
      ],
    })
    expect(db.load().stations).toEqual([station('c'), station('a', { name: 'Renamed' })])
  })

  it('replaces everything on reset', () => {
    db.write({ upsert: [{ station: station('old'), position: 0 }] })
    db.write({ reset: true, upsert: [{ station: station('new'), position: 0 }] })
    expect(db.load().stations).toEqual([station('new')])
  })

  it('writes nothing when one change in a batch fails', () => {
    db.write({ upsert: [{ station: station('a'), position: 0 }] })
    // A station without a url breaks the NOT NULL constraint.
    expect(() =>
      db.write({ remove: ['a'], upsert: [{ station: { id: 'bad', url: null as unknown as string }, position: 1 }] }),
    ).toThrow()
    expect(db.load().stations).toEqual([station('a')])
  })
})

describe('local library roots', () => {
  let music: string

  beforeEach(() => {
    db.open(file)
    music = path.join(dir, 'Music')
  })

  it('treats a trailing slash as the same folder', () => {
    expect(db.addFolder(music).status).toBe('added')
    expect(db.addFolder(music + path.sep)).toMatchObject({ status: 'exists', root: music })
    expect(db.listFolders()).toEqual([music])
  })

  it('does not add a folder inside an existing root', () => {
    db.addFolder(music)
    expect(db.addFolder(path.join(music, 'Jazz'))).toMatchObject({ status: 'inside', root: music })
    expect(db.listFolders()).toEqual([music])
  })

  it('replaces roots that a new folder contains', () => {
    const jazz = path.join(music, 'Jazz')
    const rock = path.join(music, 'Rock')
    const other = path.join(dir, 'Podcasts')
    db.addFolder(jazz)
    db.addFolder(other)
    db.addFolder(rock)
    const result = db.addFolder(music)
    expect(result).toMatchObject({ status: 'added', replaced: [jazz, rock] })
    expect(db.listFolders()).toEqual([other, music])
  })

  it('absorbs loose files that the new folder contains', () => {
    const inside = path.join(music, 'a.mp3')
    const outside = path.join(dir, 'b.mp3')
    db.addLooseFiles([inside, outside])
    expect(db.addFolder(music).absorbed).toBe(1)
    expect(db.listLooseFiles()).toEqual([outside])
  })

  it('counts loose files it skips, and why', () => {
    db.addFolder(music)
    const loose = path.join(dir, 'a.mp3')
    db.addLooseFiles([loose])
    expect(db.addLooseFiles([loose, path.join(music, 'x.mp3'), path.join(dir, 'new.mp3')])).toMatchObject({
      added: 1,
      present: 1,
      covered: 1,
    })
  })

  it('removes a root', () => {
    db.addFolder(music)
    expect(db.removeFolder(music + path.sep)).toEqual([])
  })
})

describe('queue and settings', () => {
  beforeEach(() => {
    db.open(file)
  })

  it('replaces the queue whole, in order', () => {
    db.setQueue(['/a', '/b', '/c'])
    db.setQueue(['/c', '/a'])
    expect(db.listQueue()).toEqual(['/c', '/a'])
  })

  it('stores settings as strings and deletes on null', () => {
    db.writeSettings({ 'player.volume': '0.8', 'app.view': 'local' })
    db.writeSettings({ 'player.volume': '0.5', 'app.view': null })
    expect(db.loadSettings()).toEqual({ 'player.volume': '0.5' })
  })

  it('survives closing and reopening', () => {
    db.writeSettings({ kept: 'yes' })
    db.close()
    db.open(file)
    expect(db.loadSettings()).toEqual({ kept: 'yes' })
  })
})
