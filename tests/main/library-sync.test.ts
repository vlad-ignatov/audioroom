// The renderer saves the station library by sending only the rows that
// changed (diff in libraryPersistence.ts), and the main process applies them
// (write in library-db.cjs). Neither half is wrong on its own if the two
// disagree about positions, so they are tested together: after any sequence
// of edits, the database must load back exactly the list the store holds.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import db from '../../electron/library-db.cjs'
import { diff } from '@/store/libraryPersistence'
import type { Station } from '@/types/station'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audioroom-sync-'))
  db.open(path.join(dir, 'library.sqlite'))
})

afterEach(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

let nextId = 0
function station(name = `Station ${nextId}`): Station {
  const id = `s${nextId++}`
  return {
    id,
    name,
    url: `http://radio.example/${id}`,
    tags: [],
    isHls: false,
    favorite: false,
    addedAt: 0,
    playCount: 0,
    capability: 'unknown',
  }
}

/** A small deterministic PRNG, so a failure can be replayed. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32
    return seed / 2 ** 32
  }
}

type Edit = (list: Station[], rnd: () => number) => Station[]

const pick = (list: Station[], rnd: () => number) => Math.floor(rnd() * list.length)

const EDITS: Record<string, Edit> = {
  add: (list) => [...list, station()],
  addSeveral: (list) => [...list, station(), station(), station()],
  remove: (list, rnd) => list.filter((_, i) => i !== pick(list, rnd)),
  rename: (list, rnd) => {
    const at = pick(list, rnd)
    return list.map((s, i) => (i === at ? { ...s, name: `${s.name}!`, playCount: s.playCount + 1 } : s))
  },
  move: (list, rnd) => {
    const out = [...list]
    const [moved] = out.splice(pick(list, rnd), 1)
    if (moved) out.splice(pick(out, rnd), 0, moved)
    return out
  },
  insertInMiddle: (list, rnd) => {
    const out = [...list]
    out.splice(pick(list, rnd), 0, station())
    return out
  },
  replaceAll: (list) => [station(), ...list.slice(0, 2).reverse(), station()],
}

describe('saving the station library', () => {
  it.each([1, 2, 3, 4, 5])('stays in sync through random edits (seed %i)', (seed) => {
    const rnd = random(seed)
    const names = Object.keys(EDITS)

    let list = [station(), station(), station()]
    db.write({ reset: true, upsert: list.map((s, position) => ({ station: s, position })) })
    let end = list.length

    for (let step = 0; step < 200; step++) {
      const name = names[Math.floor(rnd() * names.length)]!
      const next = EDITS[name]!(list, rnd)
      const result = diff(list, next, end)
      db.write(result.ops)
      end = result.end
      list = next

      const saved = db.load().stations as Station[]
      expect(saved, `after step ${step} (${name})`).toEqual(list)
    }
  })

  it('sends only the changed row for an edit', () => {
    const list = [station(), station(), station()]
    const next = list.map((s, i) => (i === 1 ? { ...s, favorite: true } : s))
    const { ops } = diff(list, next, 3)
    expect(ops).toEqual({ upsert: [], update: [next[1]], remove: [], reposition: [] })
  })

  it('appends without renumbering the rows already saved', () => {
    const list = [station(), station()]
    const added = station()
    const { ops, end } = diff(list, [...list, added], 2)
    expect(ops.upsert).toEqual([{ station: added, position: 2 }])
    expect(ops.reposition).toEqual([])
    expect(end).toBe(3)
  })

  it('removes without renumbering what is left', () => {
    const list = [station(), station(), station()]
    const { ops } = diff(list, [list[0]!, list[2]!], 3)
    expect(ops).toMatchObject({ remove: [list[1]!.id], upsert: [], reposition: [] })
  })
})
