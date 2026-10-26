import { describe, expect, it } from 'vitest'
import { fixCyrillic, looksMisencoded, suggestFix, tagsLookBroken } from '@/lib/encoding'

/** What an old Windows tagger did: Windows-1251 bytes, read back as Latin-1. */
function misencode(text: string): string {
  const table = new TextDecoder('windows-1251')
  const byteOf = new Map<string, number>()
  for (let b = 0; b < 256; b++) byteOf.set(table.decode(new Uint8Array([b])), b)
  return String.fromCharCode(...[...text].map((ch) => byteOf.get(ch) ?? ch.charCodeAt(0)))
}

describe('Cyrillic tag repair', () => {
  it.each(['Аз и ти', 'Кино – Группа крови', 'Щурците', 'Чук и Гек'])('recovers %j exactly', (text) => {
    const broken = misencode(text)
    expect(looksMisencoded(broken)).toBe(true)
    expect(fixCyrillic(broken)).toBe(text)
  })

  it('matches the example from the module docs', () => {
    expect(fixCyrillic('Àç è òè')).toBe('Аз и ти')
  })

  it.each(['Café del Mar', 'Garçon', 'Sigur Rós', 'Motörhead', 'Beyoncé', 'Hello World'])(
    'leaves the Western name %j alone',
    (text) => {
      expect(looksMisencoded(text)).toBe(false)
      expect(suggestFix(text)).toBeUndefined()
    },
  )

  it('leaves correctly decoded Cyrillic alone', () => {
    expect(looksMisencoded('Аз и ти')).toBe(false)
  })

  it('spots a broken word inside an otherwise Latin title', () => {
    const title = `${misencode('Бай Ганьо')} (original mix)`
    expect(looksMisencoded(title)).toBe(true)
  })

  it('checks every text field of a file', () => {
    expect(tagsLookBroken({ title: 'Fine', album: misencode('Песни') })).toBe(true)
    expect(tagsLookBroken({ title: 'Fine', artist: 'Also fine' })).toBe(false)
    expect(tagsLookBroken(undefined)).toBe(false)
  })
})
