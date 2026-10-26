import { describe, expect, it } from 'vitest'
import { parsePlaylist, toM3u } from '@/lib/playlist'

describe('parsePlaylist', () => {
  it('reads extended M3U, names from #EXTINF', () => {
    const stations = parsePlaylist(
      '#EXTM3U\r\n#EXTINF:-1,Jazz FM\r\nhttp://jazz.example/stream\r\n\r\n#EXTINF:-1,News\r\nhttps://news.example/live.m3u8\r\n',
    )
    expect(stations.map((s) => [s.name, s.url, s.isHls])).toEqual([
      ['Jazz FM', 'http://jazz.example/stream', false],
      ['News', 'https://news.example/live.m3u8', true],
    ])
  })

  it('names a station without #EXTINF after its URL', () => {
    const [station] = parsePlaylist('http://plain.example/a\n')
    expect(station?.name).toBe('http://plain.example/a')
  })

  it('does not carry a name over to the next URL', () => {
    const stations = parsePlaylist('#EXTINF:-1,First\nhttp://a/1\nhttp://a/2\n')
    expect(stations[1]?.name).toBe('http://a/2')
  })

  it('reads PLS in entry order, whatever the line order', () => {
    const stations = parsePlaylist(
      '[playlist]\nFile2=http://b/2\nTitle2=Second\nFile1=http://b/1\nTitle1=First\nNumberOfEntries=2\n',
    )
    expect(stations.map((s) => s.name)).toEqual(['First', 'Second'])
  })

  it('reads a JSON export and keeps its fields', () => {
    const json = JSON.stringify({
      stations: [
        { id: 'keep-me', name: 'A', url: 'http://a/', favorite: true },
        { name: 'No URL' },
      ],
    })
    const stations = parsePlaylist(json)
    expect(stations).toHaveLength(1)
    expect(stations[0]).toMatchObject({ id: 'keep-me', name: 'A', favorite: true, tags: [] })
  })

  it('gives every station a fresh, unique id', () => {
    const stations = parsePlaylist('http://a/1\nhttp://a/2\nhttp://a/3\n')
    expect(new Set(stations.map((s) => s.id)).size).toBe(3)
  })
})

describe('toM3u', () => {
  it('round-trips through parsePlaylist', () => {
    const original = parsePlaylist('#EXTINF:-1,One\nhttp://a/1\n#EXTINF:-1,Two\nhttp://a/2\n')
    const again = parsePlaylist(toM3u(original))
    expect(again.map((s) => [s.name, s.url])).toEqual(original.map((s) => [s.name, s.url]))
  })
})
