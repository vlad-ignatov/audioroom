import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import localFiles from '../../electron/local-files.cjs'

const { toPath, parseRange, serve, listDir, collectAudio } = localFiles

let dir: string

/** The URL the renderer hands the media element for a file (see playableUrl). */
const mediaUrl = (p: string) => `media://local${pathToFileURL(p).pathname}`

function write(rel: string, content: string | Buffer = ''): string {
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return full
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audioroom-files-'))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('toPath', () => {
  it('maps a media URL back to the file, decoding it', () => {
    const file = path.join(dir, 'Ünïcode & spaces #1.mp3')
    expect(toPath(mediaUrl(file))).toBe(file)
  })

  it('refuses any host but "local"', () => {
    expect(() => toPath('media://elsewhere/etc/passwd')).toThrow(/host/)
  })
})

describe('parseRange', () => {
  it.each([
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=100-', { start: 100, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=900-5000', { start: 900, end: 999 }],
    ['bytes=-5000', { start: 0, end: 999 }],
  ])('reads %s of a 1000-byte file', (header, expected) => {
    expect(parseRange(header, 1000)).toEqual(expected)
  })

  it.each([null, '', 'bytes=-', 'items=0-1', 'bytes=0-1,5-6'])('ignores %j', (header) => {
    expect(parseRange(header, 1000)).toBeNull()
  })

  it.each(['bytes=1000-', 'bytes=500-100'])('rejects %s as unsatisfiable', (header) => {
    expect(parseRange(header, 1000)).toEqual({ invalid: true })
  })
})

describe('serve', () => {
  const body = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))
  let file: string

  beforeAll(() => {
    file = write('Album/01 Track.mp3', body)
  })

  it('serves a whole file with CORS and range support', async () => {
    const res = await serve(new Request(mediaUrl(file)))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('content-length')).toBe('1000')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(body)
  })

  it('serves the requested range, which is what makes seeking work', async () => {
    const res = await serve(new Request(mediaUrl(file), { headers: { Range: 'bytes=100-199' } }))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 100-199/1000')
    expect(res.headers.get('content-length')).toBe('100')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(body.subarray(100, 200))
  })

  it('serves the end of the file for a suffix range', async () => {
    const res = await serve(new Request(mediaUrl(file), { headers: { Range: 'bytes=-10' } }))
    expect(res.headers.get('content-range')).toBe('bytes 990-999/1000')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(body.subarray(990))
  })

  it('answers 416 for a range past the end', async () => {
    const res = await serve(new Request(mediaUrl(file), { headers: { Range: 'bytes=5000-' } }))
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */1000')
  })

  it('answers HEAD with the size and no body', async () => {
    const res = await serve(new Request(mediaUrl(file), { method: 'HEAD' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('1000')
    expect(await res.text()).toBe('')
  })

  it('answers 404 for a missing file or a folder', async () => {
    expect((await serve(new Request(mediaUrl(path.join(dir, 'gone.mp3'))))).status).toBe(404)
    expect((await serve(new Request(mediaUrl(path.join(dir, 'Album'))))).status).toBe(404)
  })

  it('answers 400 for a URL that is not a local file', async () => {
    expect((await serve(new Request('media://other/x.mp3'))).status).toBe(400)
  })

  it('serves an empty file without failing', async () => {
    const empty = write('empty.wav')
    const res = await serve(new Request(mediaUrl(empty), { headers: { Range: 'bytes=0-' } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('0')
  })
})

describe('listDir', () => {
  let album: string

  beforeAll(() => {
    album = path.join(dir, 'Listing')
    for (const name of ['Track 10.mp3', 'Track 2.flac', 'Track 1.m4a', 'notes.txt', '.hidden.mp3']) {
      write(`Listing/${name}`)
    }
    write('Listing/Disc 10/a.mp3')
    write('Listing/Disc 2/a.mp3')
    write('Listing/AlbumArtSmall.jpg', 'x'.repeat(5000))
    write('Listing/folder.jpg', 'x'.repeat(100))
    write('Listing/Front.png', 'x'.repeat(10))
    write('Listing/back.jpg', 'x'.repeat(9000))
  })

  it('lists folders and audio files in file-manager order', async () => {
    const listing = await listDir(album)
    expect(listing.folders.map((f: { name: string }) => f.name)).toEqual(['Disc 2', 'Disc 10'])
    expect(listing.files.map((f: { name: string }) => f.name)).toEqual([
      'Track 1.m4a',
      'Track 2.flac',
      'Track 10.mp3',
    ])
  })

  it('gives each file its file:// URL', async () => {
    const [first] = (await listDir(album)).files
    expect(first.url).toBe(pathToFileURL(path.join(album, 'Track 1.m4a')).href)
  })

  it('picks the front cover over bigger thumbnails and back covers', async () => {
    const { cover } = await listDir(album)
    expect(cover).toBe(pathToFileURL(path.join(album, 'Front.png')).href)
  })

  it('has no cover when no image looks like one', async () => {
    write('NoCover/a.mp3')
    write('NoCover/AlbumArtSmall.jpg')
    expect((await listDir(path.join(dir, 'NoCover'))).cover).toBeUndefined()
  })
})

describe('collectAudio', () => {
  let root: string

  beforeAll(() => {
    root = path.join(dir, 'Collect')
    write('Collect/b.mp3')
    write('Collect/a.mp3')
    write('Collect/cover.jpg')
    write('Collect/Sub/c.mp3')
    write('Collect/Sub/d.mp3')
  })

  it('walks subfolders first, then files, like the tree', async () => {
    const { paths, truncated } = await collectAudio([root], 100)
    expect(paths.map((p: string) => path.relative(root, p))).toEqual([
      path.join('Sub', 'c.mp3'),
      path.join('Sub', 'd.mp3'),
      'a.mp3',
      'b.mp3',
    ])
    expect(truncated).toBe(false)
  })

  it('stops at the limit and says so', async () => {
    const { paths, truncated } = await collectAudio([root], 2)
    expect(paths).toHaveLength(2)
    expect(truncated).toBe(true)
  })

  it('passes over files already queued, without counting them', async () => {
    const skip = [path.join(root, 'Sub', 'c.mp3')]
    const { paths } = await collectAudio([root], 3, skip)
    expect(paths.map((p: string) => path.basename(p))).toEqual(['d.mp3', 'a.mp3', 'b.mp3'])
  })

  it('takes single files and ignores what is not audio', async () => {
    const { paths } = await collectAudio([path.join(root, 'a.mp3'), path.join(root, 'cover.jpg')], 10)
    expect(paths).toEqual([path.join(root, 'a.mp3')])
  })

  it.skipIf(process.platform === 'win32')('does not loop forever on a symlink cycle', async () => {
    fs.symlinkSync(root, path.join(root, 'Sub', 'loop'))
    const { paths } = await collectAudio([root], 100)
    expect(paths).toHaveLength(4)
  })
})
