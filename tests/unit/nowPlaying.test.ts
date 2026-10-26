import { describe, expect, it } from 'vitest'
import { interpret, titleFromStatusPayload } from '@/audio/nowPlaying'

describe('interpret', () => {
  it('splits the ICY "Artist - Title" convention', () => {
    expect(interpret('Daft Punk - One More Time')).toEqual({
      text: 'Daft Punk - One More Time',
      artist: 'Daft Punk',
      title: 'One More Time',
    })
  })

  it('keeps a title without a separator whole', () => {
    expect(interpret('Morning Show with Anna')).toEqual({
      text: 'Morning Show with Anna',
      title: 'Morning Show with Anna',
    })
  })

  it('does not split on a hyphen inside a word', () => {
    expect(interpret('Jay-Z')).toMatchObject({ title: 'Jay-Z' })
    expect(interpret('Jay-Z')?.artist).toBeUndefined()
  })

  it('collapses whitespace', () => {
    expect(interpret('  Artist   -  Song \n')?.text).toBe('Artist - Song')
  })

  it.each([null, undefined, '', '   ', '287105 - 403761', ' - '])('rejects %j', (raw) => {
    expect(interpret(raw)).toBeNull()
  })

  it.each(['Spot Block End', 'ad break', 'Advertisement', 'Unknown', 'N/A'])(
    'treats the automation marker %j as no track',
    (raw) => {
      expect(interpret(raw)).toBeNull()
    },
  )

  it('reads tagged title and artist, ignoring the ids around them', () => {
    const raw =
      'title="ONE LAST TIME",artist="Ariana Grande",url="song_spot="F" TPID="28113741" amgArtistId="0"'
    expect(interpret(raw)).toEqual({
      text: 'Ariana Grande - ONE LAST TIME',
      artist: 'Ariana Grande',
      title: 'ONE LAST TIME',
    })
  })

  it('does not take amgArtistId or itunesTrackId for the artist or title', () => {
    const raw = 'amgArtistId="123" itunesTrackId="456" text="Real Song"'
    expect(interpret(raw)).toMatchObject({ title: 'Real Song' })
  })

  it('uses the text before the tags when there are no explicit fields', () => {
    expect(interpret('Artist - Title text="ignored" amgArtworkURL="null"')).toMatchObject({
      artist: 'Artist',
      title: 'Title',
    })
  })

  it('drops an ad marker sent in the text field', () => {
    expect(interpret('- text="Spot Block End" amgTrackId="9876543" length="00:00:00"')).toBeNull()
  })

  it('shortens text too long to be a track', () => {
    const result = interpret('x'.repeat(500))
    expect(result?.text).toHaveLength(201)
    expect(result?.text.endsWith('…')).toBe(true)
  })
})

describe('titleFromStatusPayload', () => {
  const icecast = (sources: object[] | object) => JSON.stringify({ icestats: { source: sources } })

  it('picks the source whose mount matches the stream', () => {
    const doc = icecast([
      { listenurl: 'http://radio.example:8000/jazz', title: 'Wrong Station - Song' },
      { listenurl: 'http://radio.example:8000/rock', title: 'Right Band - Song' },
    ])
    expect(titleFromStatusPayload(doc, 'https://radio.example/rock')).toBe('Right Band - Song')
  })

  it('matches mounts ignoring case and a trailing slash', () => {
    const doc = icecast([
      { listenurl: 'http://a/other', title: 'No' },
      { listenurl: 'http://a/Live/', title: 'Yes' },
    ])
    expect(titleFromStatusPayload(doc, 'http://a/live')).toBe('Yes')
  })

  it("returns nothing rather than another station's track", () => {
    const doc = icecast([
      { listenurl: 'http://a/one', title: 'One' },
      { listenurl: 'http://a/two', title: 'Two' },
    ])
    expect(titleFromStatusPayload(doc, 'http://a/three')).toBeNull()
  })

  it('trusts a server with a single source', () => {
    expect(titleFromStatusPayload(icecast({ title: 'Only - One' }), 'http://a/x')).toBe('Only - One')
  })

  it('falls back to yp_currently_playing', () => {
    const doc = icecast({ listenurl: 'http://a/x', yp_currently_playing: 'Fallback' })
    expect(titleFromStatusPayload(doc, 'http://a/x')).toBe('Fallback')
  })

  it('reads a Shoutcast document', () => {
    expect(titleFromStatusPayload('{"songtitle":"Shout - Cast"}', 'http://a/')).toBe('Shout - Cast')
  })

  it('reports nothing for truncated JSON, never the raw payload', () => {
    const doc = icecast([{ listenurl: 'http://a/x', title: 'T' }])
    expect(titleFromStatusPayload(doc.slice(0, 30), 'http://a/x')).toBeNull()
  })

  it('ignores an HTML error page', () => {
    expect(titleFromStatusPayload('<html><body>404</body></html>', 'http://a/')).toBeNull()
  })

  it('reads the bare title /currentsong answers with', () => {
    expect(titleFromStatusPayload('Band - Song\n', 'http://a/')).toBe('Band - Song')
  })
})
