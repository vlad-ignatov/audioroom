import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import NodeID3 from 'node-id3'
import tagWriter from '../../electron/tag-writer.cjs'

const { writeTags } = tagWriter

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audioroom-tags-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Stand-in audio: tag writing never decodes it, only has to keep it intact. */
const AUDIO = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7) % 256))

/** A 128-byte ID3v1.1 tag, Latin-1 fields padded with NULs. */
function id3v1({ title = '', artist = '', album = '', year = '', track = 0, genre = 255 }) {
  const tag = Buffer.alloc(128)
  tag.write('TAG', 0, 'latin1')
  tag.write(title, 3, 30, 'latin1')
  tag.write(artist, 33, 30, 'latin1')
  tag.write(album, 63, 30, 'latin1')
  tag.write(year, 93, 4, 'latin1')
  tag[126] = track
  tag[127] = genre
  return tag
}

function mp3(name: string, content: Buffer): string {
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

const hasId3v1 = (buf: Buffer) => buf.length >= 128 && buf.toString('latin1', buf.length - 128, buf.length - 125) === 'TAG'

describe('writeTags', () => {
  it('writes Cyrillic text that reads back exactly', async () => {
    const file = mp3('a.mp3', AUDIO)
    await writeTags(file, { title: 'Аз и ти', artist: 'Щурците' })
    expect(NodeID3.read(file)).toMatchObject({ title: 'Аз и ти', artist: 'Щурците' })
  })

  it('leaves the audio itself untouched', async () => {
    const file = mp3('a.mp3', Buffer.concat([AUDIO, id3v1({ title: 'Old' })]))
    await writeTags(file, { title: 'New' })
    expect(fs.readFileSync(file).includes(AUDIO)).toBe(true)
  })

  it('drops the ID3v1 tag but keeps what only it held', async () => {
    const file = mp3('a.mp3', Buffer.concat([AUDIO, id3v1({ title: 'Garbled', artist: 'Old Artist', album: 'Old Album', year: '1999' })]))
    await writeTags(file, { title: 'Fixed' })

    const buf = fs.readFileSync(file)
    expect(hasId3v1(buf)).toBe(false)
    expect(NodeID3.read(buf)).toMatchObject({
      title: 'Fixed',
      artist: 'Old Artist',
      album: 'Old Album',
      year: '1999',
    })
  })

  it('does not invent a track number from the padding', async () => {
    // Space padding in the comment field reads as track 32 in ID3v1.1.
    const file = mp3('a.mp3', Buffer.concat([AUDIO, id3v1({ title: 'T', track: 32 })]))
    await writeTags(file, { album: 'A' })
    expect(NodeID3.read(file).trackNumber).toBeUndefined()
  })

  it('keeps frames it was not asked to change', async () => {
    const tagged = NodeID3.write(
      {
        title: 'Title',
        album: 'Album',
        comment: { language: 'eng', text: 'A comment' },
        userDefinedText: [{ description: 'MOOD', value: 'Calm' }],
      },
      AUDIO,
    ) as Buffer
    const file = mp3('a.mp3', tagged)
    await writeTags(file, { artist: 'Artist' })

    expect(NodeID3.read(file)).toMatchObject({
      title: 'Title',
      album: 'Album',
      artist: 'Artist',
      comment: { text: 'A comment' },
      userDefinedText: [{ description: 'MOOD', value: 'Calm' }],
    })
  })

  it('removes a field set to an empty string, and trims the rest', async () => {
    const file = mp3('a.mp3', NodeID3.write({ title: 'T', album: 'Remove me' }, AUDIO) as Buffer)
    await writeTags(file, { album: '', title: '  Padded  ' })
    const tags = NodeID3.read(file)
    expect(tags.album).toBeUndefined()
    expect(tags.title).toBe('Padded')
  })

  it('refuses anything but MP3, and leaves the file alone', async () => {
    const file = mp3('a.flac', AUDIO)
    await expect(writeTags(file, { title: 'X' })).rejects.toThrow(/MP3/)
    expect(fs.readFileSync(file)).toEqual(AUDIO)
  })

  it('leaves no temporary file behind', async () => {
    const file = mp3('a.mp3', AUDIO)
    await writeTags(file, { title: 'X' })
    expect(fs.readdirSync(dir)).toEqual(['a.mp3'])
  })

  it.skipIf(process.platform === 'win32')('keeps the file permissions', async () => {
    const file = mp3('a.mp3', AUDIO)
    fs.chmodSync(file, 0o640)
    await writeTags(file, { title: 'X' })
    expect(fs.statSync(file).mode & 0o777).toBe(0o640)
  })
})
