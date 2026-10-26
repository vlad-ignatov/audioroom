import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsStorage } from '@/lib/settings'

/** A localStorage stand-in over a Map. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  }
}

/**
 * Load the settings module as the desktop app would: `saved` is what the
 * database holds, `local` what this origin's localStorage holds.
 */
async function openSettings({
  saved,
  local = {},
  origin = 'http://localhost:5199',
}: {
  saved: Record<string, string> | null
  local?: Record<string, string>
  origin?: string
}) {
  const writes: Array<Record<string, string | null>> = []
  const bridge = {
    isDesktop: true,
    settings: {
      load: () => saved,
      write: (changes: Record<string, string | null>) => void writes.push(changes),
    },
  }
  const localStorage = memoryStorage(local)
  vi.stubGlobal('window', { desktop: bridge })
  vi.stubGlobal('location', { origin })
  vi.stubGlobal('localStorage', localStorage)
  vi.resetModules()
  const { settings } = (await import('@/lib/settings')) as { settings: SettingsStorage }
  // Writes are sent in a microtask; let them go.
  const flush = async () => {
    await Promise.resolve()
    return writes.splice(0)
  }
  return { settings, flush, localStorage }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('settings on the desktop', () => {
  it('reads what the database holds', async () => {
    const { settings } = await openSettings({
      saved: { 'player.volume': '0.4', '$imported:http://localhost:5199': 'x' },
    })
    expect(settings.getItem('player.volume')).toBe('0.4')
    expect(settings.getItem('missing')).toBeNull()
  })

  it('sends a burst of changes in one write', async () => {
    const { settings, flush } = await openSettings({ saved: { '$imported:http://localhost:5199': 'x' } })
    settings.setItem('a', '1')
    settings.setItem('b', '2')
    settings.setItem('a', '3')
    settings.removeItem('b')
    expect(await flush()).toEqual([{ a: '3', b: null }])
    expect(settings.getItem('a')).toBe('3')
  })

  it('does not write a value that did not change', async () => {
    const { settings, flush } = await openSettings({
      saved: { a: '1', '$imported:http://localhost:5199': 'x' },
    })
    settings.setItem('a', '1')
    settings.removeItem('never-set')
    expect(await flush()).toEqual([])
  })

  it("brings over this origin's localStorage once, without overwriting", async () => {
    const { settings, flush } = await openSettings({
      saved: { 'player.eq': '{"from":"database"}' },
      local: {
        'player.eq': '{"from":"localStorage"}',
        'player.volume': '0.7',
        'unrelated.key': 'not imported',
      },
    })
    expect(settings.getItem('player.eq')).toBe('{"from":"database"}')
    expect(settings.getItem('player.volume')).toBe('0.7')
    expect(settings.getItem('unrelated.key')).toBeNull()

    const [written] = await flush()
    expect(written).toMatchObject({ 'player.volume': '0.7' })
    expect(written).not.toHaveProperty('player.eq')
    expect(written?.['$imported:http://localhost:5199']).toBeTruthy()
  })

  it('does not import again once the origin is marked', async () => {
    const { settings, flush } = await openSettings({
      saved: { '$imported:file://': 'earlier' },
      local: { 'player.volume': '0.7' },
      origin: 'file://',
    })
    expect(settings.getItem('player.volume')).toBeNull()
    expect(await flush()).toEqual([])
  })

  it('falls back to localStorage when the database is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { settings, flush, localStorage } = await openSettings({
      saved: null,
      local: { 'player.volume': '0.2' },
    })
    expect(settings.getItem('player.volume')).toBe('0.2')
    settings.setItem('player.volume', '0.9')
    expect(localStorage.map.get('player.volume')).toBe('0.9')
    expect(await flush()).toEqual([])
  })
})
