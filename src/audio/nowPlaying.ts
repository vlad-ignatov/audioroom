/**
 * Reading the currently playing track from a radio stream.
 *
 * There is no single mechanism for this, and no way to get it from the <audio>
 * element, so we try the cheap options first and remember which one worked for
 * a given station:
 *
 *  1. A status endpoint (`/status-json.xsl`, `/stats?json=1`, `/currentsong`).
 *     A plain GET of a few kilobytes, and crucially no custom request header,
 *     so it needs no CORS preflight.
 *  2. ICY in-stream metadata. Requires the `Icy-MetaData: 1` request header,
 *     which is *not* CORS-safelisted, so the browser sends a preflight that
 *     many stream servers simply do not answer. Where it works it is the most
 *     reliable source; where it does not, the request fails outright.
 *
 * Neither is universal. Roughly half the stations tested expose a usable title
 * by one route or the other; the rest expose nothing and the UI says so.
 */

export type NowPlayingSource = 'status' | 'icy'

export interface NowPlaying {
  /** The raw metadata string, shown to the listener as-is. */
  text: string
  artist?: string
  title?: string
  source: NowPlayingSource
}

/** How much of a stream we are willing to pull while hunting for a title. */
const ICY_BYTE_CAP = 96 * 1024
/**
 * Read cap for a status document. A server hosting hundreds of mounts answers
 * with tens of kilobytes, and truncating it makes the JSON unparseable.
 */
const STATUS_BYTE_CAP = 512 * 1024
const TIMEOUT_MS = 8000

function withTimeout(signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      ctrl.abort()
    },
  }
}

/**
 * Reject strings that are technically metadata but not a track: an empty slot,
 * or an all-numeric internal id (some networks broadcast `"287105 - 403761"`).
 * Anything with letters is shown as sent — a station that broadcasts its own
 * name or a tracklist URL is genuinely what is on the wire.
 */
function usable(raw: string | null | undefined): string | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (!/\p{L}/u.test(text)) return null
  return text
}

/** ICY convention is "Artist - Title", though plenty of stations ignore it. */
function split(text: string): { artist?: string; title?: string } {
  const parts = text.split(/\s+-\s+/)
  if (parts.length === 2 && parts[0]!.trim() && parts[1]!.trim()) {
    return { artist: parts[0]!.trim(), title: parts[1]!.trim() }
  }
  return { title: text }
}

/**
 * Key/value pairs embedded in a metadata string: `title="X"`, `text="Y"`.
 *
 * Separators vary by broadcaster — commas in some feeds, spaces in others — so
 * the pairs are matched wherever they appear rather than by splitting first.
 */
const TAG_PAIR = /([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*"([^"]*)"/g

/** Leading and trailing separator debris left when a field comes back empty. */
const EDGE_SEPARATORS = /^[\s\-–—:,|]+|[\s\-–—:,|]+$/g

/**
 * Automation markers that are metadata about the broadcast rather than a track.
 * These arrive in the same field a title would, so they have to be named.
 */
const NON_TRACK =
  /^(spot ?block ?(start|end)|ad ?break|advert(isement)?|commercial|sweeper|liner|unknown|n\/?a|none|null|-)$/i

function isNonTrack(value: string | undefined): boolean {
  return value !== undefined && NON_TRACK.test(value.trim())
}

/**
 * Read a metadata string that carries tagged fields.
 *
 * Broadcasters send several shapes through the same channel:
 *
 *   title="ONE LAST TIME",artist="Ariana Grande",url="song_spot="F" TPID="28113741" …
 *   - text="Spot Block End" amgTrackId="9876543" length="00:00:00"
 *   Artist - Title text="…" amgArtworkURL="null"
 *
 * All of them mix a human-readable part with scheduling and rights ids that
 * must never reach the listener. Collect every pair, keep the two or three
 * fields that mean something, and discard the rest. Matching whole keys means
 * `amgArtistId` and `itunesTrackId` cannot be mistaken for `artist` or `title`.
 */
function parseTagged(raw: string): { artist?: string; title?: string } | null {
  const tags = new Map<string, string>()
  let firstTagAt = -1

  TAG_PAIR.lastIndex = 0
  for (let m = TAG_PAIR.exec(raw); m !== null; m = TAG_PAIR.exec(raw)) {
    const key = m[1]!.toLowerCase()
    if (!tags.has(key)) tags.set(key, m[2]!.replace(/\s+/g, ' ').trim())
    if (firstTagAt < 0) firstTagAt = m.index
  }
  if (tags.size === 0) return null

  const clean = (v: string | undefined) => {
    const out = (v ?? '').replace(EDGE_SEPARATORS, '').trim()
    return out || undefined
  }

  const title = clean(tags.get('title'))
  const artist = clean(tags.get('artist'))
  if (title || artist) return { title, artist }

  // No explicit fields: anything before the first tag is the human part, as in
  // `Artist - Title text="…"`. A bare separator means the feed sent nothing.
  const lead = clean(raw.slice(0, firstTagAt < 0 ? 0 : firstTagAt))
  if (lead) return split(lead)

  // Last resort: some feeds put the track in `text`, others put an ad marker
  // there. Either way it is the only human-readable field left.
  const text = clean(tags.get('text'))
  return text ? { title: text } : null
}

/** Longest sensible track line; anything beyond this is metadata spillage. */
const MAX_TEXT = 200

/**
 * Turn a raw metadata string into what the listener sees.
 *
 * Shared by both routes, because a station that sends a tagged payload over ICY
 * generally reports the same string through its status endpoint.
 */
export function interpret(raw: string | null | undefined): {
  text: string
  artist?: string
  title?: string
} | null {
  const cleaned = usable(raw)
  if (!cleaned) return null

  const tagged = parseTagged(cleaned)
  if (tagged) {
    // An ad marker is not a track; the UI is better off saying nothing.
    if (isNonTrack(tagged.title) && !tagged.artist) return null
    const text = [tagged.artist, tagged.title].filter(Boolean).join(' - ')
    return usable(text) ? { text, ...tagged } : null
  }

  const plain = cleaned.replace(EDGE_SEPARATORS, '').trim()
  if (!plain || isNonTrack(plain)) return null

  // Not tagged, but still implausibly long: show the front of it rather than
  // letting an unrecognised format overrun the player bar.
  const text = plain.length > MAX_TEXT ? `${plain.slice(0, MAX_TEXT).trimEnd()}…` : plain
  return { text, ...split(text) }
}

function statusEndpoints(streamUrl: string): string[] {
  try {
    const base = new URL(streamUrl)
    return [
      new URL('/status-json.xsl', base).href,
      new URL('/stats?json=1', base).href,
      new URL('/currentsong?sid=1', base).href,
    ]
  } catch {
    return []
  }
}

/** Read at most `cap` bytes, so a server that ignores the path and returns the
 *  endless stream cannot hang us. */
async function readCapped(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let out = ''
  let read = 0
  while (read < cap) {
    const { done, value } = await reader.read()
    if (done || !value) break
    read += value.length
    out += decoder.decode(value, { stream: true })
  }
  void reader.cancel().catch(() => {})
  return out
}

/** The mount path a stream URL points at, lower-cased for comparison. */
function mountOf(url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '').toLowerCase()
    return path === '' ? null : path
  } catch {
    return null
  }
}

/**
 * Pull the current title out of a status document.
 *
 * Two traps here, both of which this server sets:
 *
 * A single Icecast can host hundreds of mounts and reports them all in one
 * document, so the first source with a title is very unlikely to be the station
 * being listened to. Sources are matched by their `listenurl` mount instead,
 * and when no source matches, nothing is returned — another station's track is
 * worse than no track at all.
 *
 * And a document listing that many mounts runs to tens of kilobytes, so a
 * truncated read leaves unparseable JSON. That must not fall through to the
 * bare-text branch, which exists for `/currentsong`; doing so put raw JSON in
 * the player bar.
 */
export function titleFromStatusPayload(text: string, streamUrl: string): string | null {
  const trimmed = text.trimStart()

  // An error page is neither JSON nor a song title.
  if (trimmed.startsWith('<')) return null

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let json: Record<string, unknown>
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      // Malformed or truncated: report nothing rather than raw payload.
      return null
    }

    const stats = json['icestats'] as Record<string, unknown> | undefined
    const raw = stats?.['source']
    const sources = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<
      Record<string, unknown>
    >

    const titleOf = (s: Record<string, unknown>) =>
      usable((s['title'] as string) ?? (s['yp_currently_playing'] as string) ?? null)

    if (sources.length > 0) {
      const mount = mountOf(streamUrl)
      const mine = sources.find((s) => {
        const listen = s['listenurl']
        return typeof listen === 'string' && mount !== null && mountOf(listen) === mount
      })
      if (mine) return titleOf(mine)
      // One source, one station: no ambiguity to resolve.
      if (sources.length === 1) return titleOf(sources[0]!)
      return null
    }

    // Shoutcast-style documents describe a single station at the top level.
    return usable((json['songtitle'] as string) ?? (json['title'] as string) ?? null)
  }

  // `/currentsong` answers with a bare title.
  return usable(text.slice(0, 200))
}

async function fromStatus(streamUrl: string, signal?: AbortSignal): Promise<NowPlaying | null> {
  for (const endpoint of statusEndpoints(streamUrl)) {
    const t = withTimeout(signal)
    try {
      const res = await fetch(endpoint, { mode: 'cors', cache: 'no-store', signal: t.signal })
      if (!res.ok) continue
      // Some servers ignore the path entirely and start sending audio; that
      // decodes to replacement characters rather than anything readable.
      const body = await readCapped(res, STATUS_BYTE_CAP)
      if (body.includes('�')) continue
      const parsed = interpret(titleFromStatusPayload(body, streamUrl))
      if (parsed) return { ...parsed, source: 'status' }
    } catch {
      // try the next candidate
    } finally {
      t.done()
    }
  }
  return null
}

async function fromIcy(streamUrl: string, signal?: AbortSignal): Promise<NowPlaying | null> {
  const t = withTimeout(signal)
  try {
    const res = await fetch(streamUrl, {
      mode: 'cors',
      cache: 'no-store',
      signal: t.signal,
      // Not CORS-safelisted: this is what triggers the preflight.
      headers: { 'Icy-MetaData': '1' },
    })
    const reader = res.body?.getReader()
    if (!reader) return null
    // ICY metadata is ASCII embedded in the audio, so decode as latin1 and scan
    // rather than trying to honour icy-metaint, whose header many servers do
    // not expose to script anyway.
    const decoder = new TextDecoder('latin1')
    let buffer = ''
    let read = 0
    try {
      while (read < ICY_BYTE_CAP) {
        const { done, value } = await reader.read()
        if (done || !value) break
        read += value.length
        buffer += decoder.decode(value, { stream: true })
        const match = /StreamTitle='([^']*)'/.exec(buffer)
        if (match) {
          const parsed = interpret(match[1])
          return parsed ? { ...parsed, source: 'icy' } : null
        }
        // Keep a tail so a title straddling two chunks still matches.
        if (buffer.length > 64 * 1024) buffer = buffer.slice(-32 * 1024)
      }
    } finally {
      void reader.cancel().catch(() => {})
    }
    return null
  } catch {
    return null
  } finally {
    t.done()
  }
}

/**
 * Try every route, preferring whichever worked last time for this station so a
 * repeat poll costs one request instead of four.
 */
export async function fetchNowPlaying(
  streamUrl: string,
  preferred?: NowPlayingSource,
  signal?: AbortSignal,
): Promise<NowPlaying | null> {
  const order: NowPlayingSource[] =
    preferred === 'icy' ? ['icy', 'status'] : ['status', 'icy']
  for (const kind of order) {
    if (signal?.aborted) return null
    const hit = kind === 'status'
      ? await fromStatus(streamUrl, signal)
      : await fromIcy(streamUrl, signal)
    if (hit) return hit
  }
  return null
}
