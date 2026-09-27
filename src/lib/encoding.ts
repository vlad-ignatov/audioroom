/**
 * Repairing tags written in a Cyrillic codepage and labelled Latin-1.
 *
 * Old Windows taggers stored Bulgarian and Russian text as Windows-1251 bytes
 * in ID3 frames marked ISO-8859-1, so every reader decodes "Аз и ти" as
 * "Àç è òè". No byte was lost: turning each character back into its byte and
 * decoding those as Windows-1251 recovers the original exactly.
 */

const decoder = new TextDecoder('windows-1251')

/** Latin-1 letters in the range those bytes land on: À–ÿ, plus ÷ and × (ч, Ч). */
function isHigh(code: number): boolean {
  return code >= 0xc0 && code <= 0xff
}

/**
 * Whether text looks like Windows-1251 read as Latin-1.
 *
 * Mostly accented Latin letters is the tell. Real Western text has a few
 * ("Café", "Garçon"), so at least half the letters must be in that range, and
 * anything already outside Latin-1 is taken to be decoded correctly.
 */
export function looksMisencoded(text: string | undefined): boolean {
  if (!text) return false
  let high = 0
  let letters = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code > 0xff) return false
    if (isHigh(code)) {
      high++
      letters++
    } else if (/\p{L}/u.test(ch)) {
      letters++
    }
  }
  if (high >= 2 && high / letters >= 0.5) return true
  // A mixed title — "Áàé Õóé (original)" — still gives itself away by whole
  // words of nothing but such letters, which Western languages never produce.
  return /(?:^|[^\p{L}])[\u00c0-\u00ff]{3,}(?![\p{L}])/u.test(text)
}

/** The text re-read as Windows-1251. Only meaningful when looksMisencoded(). */
export function fixCyrillic(text: string): string {
  const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff)
  return decoder.decode(bytes)
}

/** Whether any of a file's text tags looks mis-encoded. */
export function tagsLookBroken(tags: { title?: string; artist?: string; album?: string } | undefined): boolean {
  return !!tags && (looksMisencoded(tags.title) || looksMisencoded(tags.artist) || looksMisencoded(tags.album))
}

/** The repaired text if it needs repairing, otherwise undefined. */
export function suggestFix(text: string | undefined): string | undefined {
  return text && looksMisencoded(text) ? fixCyrillic(text) : undefined
}
