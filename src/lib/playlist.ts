import type { Station } from '@/types/station'
import { looksLikeHls } from '@/audio/probe'
import { uid } from './utils'

function blankStation(name: string, url: string): Station {
  return {
    id: uid(),
    name: name.trim() || url,
    url: url.trim(),
    tags: [],
    isHls: looksLikeHls(url),
    favorite: false,
    addedAt: Date.now(),
    playCount: 0,
    capability: 'unknown',
  }
}

/** Parse extended M3U, plain URL lists, and PLS into stations. */
export function parsePlaylist(text: string): Station[] {
  const trimmed = text.trim()
  if (/^\[playlist\]/im.test(trimmed)) return parsePls(trimmed)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return parseJson(trimmed)
  return parseM3u(trimmed)
}

function parseM3u(text: string): Station[] {
  const out: Station[] = []
  let pendingName = ''
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim()
    if (!l) continue
    if (l.startsWith('#EXTINF')) {
      const comma = l.indexOf(',')
      pendingName = comma >= 0 ? l.slice(comma + 1).trim() : ''
      continue
    }
    if (l.startsWith('#')) continue
    out.push(blankStation(pendingName, l))
    pendingName = ''
  }
  return out
}

function parsePls(text: string): Station[] {
  const files = new Map<string, string>()
  const titles = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^(File|Title)(\d+)\s*=\s*(.*)$/i.exec(line.trim())
    if (!m) continue
    const [, key, idx, value] = m
    ;(key!.toLowerCase() === 'file' ? files : titles).set(idx!, value!.trim())
  }
  return [...files.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([idx, url]) => blankStation(titles.get(idx) ?? '', url))
}

function parseJson(text: string): Station[] {
  const data = JSON.parse(text) as unknown
  const list = Array.isArray(data) ? data : (data as { stations?: unknown[] }).stations
  if (!Array.isArray(list)) return []
  return list.flatMap((raw) => {
    const s = raw as Partial<Station>
    if (typeof s.url !== 'string' || !s.url) return []
    return [{ ...blankStation(s.name ?? '', s.url), ...s, id: s.id ?? uid() } as Station]
  })
}

export function toM3u(stations: Station[]): string {
  const lines = ['#EXTM3U']
  for (const s of stations) {
    lines.push(`#EXTINF:-1,${s.name}`)
    lines.push(s.url)
  }
  return lines.join('\n') + '\n'
}

export function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
