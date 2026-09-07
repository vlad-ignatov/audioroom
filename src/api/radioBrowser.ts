import type { Station } from '@/types/station'
import { looksLikeHls } from '@/audio/probe'

/** Shape of a station record as returned by the radio-browser API. */
interface RbStation {
  stationuuid: string
  name: string
  url: string
  url_resolved: string
  homepage: string
  favicon: string
  tags: string
  country: string
  countrycode: string
  language: string
  votes: number
  codec: string
  bitrate: number
  hls: number
  lastcheckok: number
}

/**
 * The project publishes its mirrors over DNS round-robin, which a browser
 * cannot resolve, so we ask a known host for the current list and fall back to
 * the long-lived German mirror if even that is unreachable.
 */
const FALLBACK_HOSTS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info']
let hostPromise: Promise<string> | null = null

async function getHost(): Promise<string> {
  hostPromise ??= (async () => {
    try {
      const res = await fetch('https://all.api.radio-browser.info/json/servers', {
        signal: AbortSignal.timeout(5000),
      })
      const servers: Array<{ name: string }> = await res.json()
      const names = [...new Set(servers.map((s) => s.name))].filter(Boolean)
      if (names.length > 0) return names[Math.floor(Math.random() * names.length)]!
    } catch {
      // fall through
    }
    return FALLBACK_HOSTS[0]!
  })()
  return hostPromise
}

async function api<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const host = await getHost()
  // An empty filter is an exact-match on the empty string, not "no filter":
  // sending `codec=` alone is enough to make every search return zero rows.
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => [k, String(v)]),
  )
  const url = `https://${host}/json/${path}?${qs}`
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`Directory error ${res.status}`)
  return res.json() as Promise<T>
}

export type SearchOrder = 'votes' | 'clickcount' | 'name' | 'bitrate' | 'random'

export interface SearchParams {
  name?: string
  tag?: string
  country?: string
  language?: string
  codec?: string
  order?: SearchOrder
  limit?: number
  offset?: number
  /** Restrict to https streams, which are the only ones a deployed https app can play. */
  httpsOnly?: boolean
}

export async function searchStations(p: SearchParams): Promise<Station[]> {
  const raw = await api<RbStation[]>('stations/search', {
    name: p.name ?? '',
    tag: p.tag ?? '',
    country: p.country ?? '',
    language: p.language ?? '',
    codec: p.codec ?? '',
    order: p.order ?? 'votes',
    reverse: p.order !== 'name',
    limit: p.limit ?? 400,
    offset: p.offset ?? 0,
    hidebroken: true,
  })
  const mapped = raw.map(fromRb)
  return p.httpsOnly ? mapped.filter((s) => s.url.startsWith('https:')) : mapped
}

export async function topStations(limit = 200): Promise<Station[]> {
  const raw = await api<RbStation[]>('stations/topclick', { limit, hidebroken: true })
  return raw.map(fromRb)
}

export async function listTags(limit = 300): Promise<Array<{ name: string; stationcount: number }>> {
  return api('tags', { limit, order: 'stationcount', reverse: true, hidebroken: true })
}

export async function listCountries(): Promise<Array<{ name: string; iso_3166_1: string; stationcount: number }>> {
  return api('countries', { order: 'stationcount', reverse: true })
}

export async function listLanguages(limit = 200): Promise<Array<{ name: string; stationcount: number }>> {
  return api('languages', { limit, order: 'stationcount', reverse: true })
}

/** Register a play with the directory so its popularity rankings stay useful. */
export function registerClick(stationuuid: string): void {
  void getHost()
    .then((host) => fetch(`https://${host}/json/url/${stationuuid}`, { method: 'POST' }))
    .catch(() => {})
}

function fromRb(s: RbStation): Station {
  const url = s.url_resolved || s.url
  return {
    id: `rb:${s.stationuuid}`,
    sourceUuid: s.stationuuid,
    name: s.name.trim() || 'Untitled station',
    url,
    homepage: s.homepage || undefined,
    favicon: s.favicon || undefined,
    codec: s.codec && s.codec !== 'UNKNOWN' ? s.codec : undefined,
    bitrate: s.bitrate || undefined,
    country: s.country || undefined,
    countryCode: s.countrycode || undefined,
    language: s.language ? s.language.split(',')[0]!.trim() : undefined,
    tags: s.tags ? s.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    votes: s.votes,
    isHls: s.hls === 1 || looksLikeHls(url),
    favorite: false,
    addedAt: Date.now(),
    playCount: 0,
    capability: 'unknown',
  }
}
