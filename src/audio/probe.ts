import type { Capability } from '@/types/station'
import { isDesktop, isLocalFile } from '@/lib/desktop'

export interface UrlPlan {
  /** The URL we should actually hand to the audio element. */
  url: string
  isHls: boolean
  /** Set when the original URL cannot be used as-is from this page. */
  upgraded: boolean
  blockedReason?: string
}

const pageIsSecure = () => typeof location !== 'undefined' && location.protocol === 'https:'

export function looksLikeHls(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url)
}

/**
 * Whether hls.js will actually handle an HLS stream here, rather than standing
 * down and letting the element play it natively.
 *
 * Mirrors the Media Source check hls.js makes internally. iOS Safari exposes
 * only `ManagedMediaSource`, and older iOS versions none at all.
 */
function canUseMseHls(): boolean {
  if (typeof self === 'undefined') return false
  const g = self as unknown as Record<string, { isTypeSupported?: (t: string) => boolean } | undefined>
  const ms = g.MediaSource ?? g.ManagedMediaSource ?? g.WebKitMediaSource
  return typeof ms?.isTypeSupported === 'function' && ms.isTypeSupported('audio/mp4; codecs="mp4a.40.2"')
}

/**
 * Decide how (or whether) a URL can be loaded from the current page.
 *
 * The dominant real-world failure is not CORS but mixed content: a large share
 * of directory stations are http-only, and an https page refuses them outright.
 * Upgrading the scheme rescues a meaningful fraction, so we always try.
 */
export function planUrl(rawUrl: string): UrlPlan {
  const isHls = looksLikeHls(rawUrl)
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { url: rawUrl, isHls, upgraded: false, blockedReason: 'Malformed stream URL.' }
  }

  // On the desktop the main process fetches outside the browser's rules, so
  // there is no mixed content to avoid — and rewriting a working http:// stream
  // to an https:// that may not exist only breaks it.
  if (!isDesktop && url.protocol === 'http:' && pageIsSecure()) {
    url.protocol = 'https:'
    return { url: url.toString(), isHls, upgraded: true }
  }
  return { url: rawUrl, isHls, upgraded: false }
}

export interface ProbeResult {
  capability: Capability
  /** The URL that actually worked, which may differ from the one passed in. */
  url: string
  reason?: string
}

/**
 * Ask the server, without committing to playback, whether Web Audio may touch
 * this stream.
 *
 * `fetch(..., { mode: 'cors' })` rejects when the response carries no
 * `Access-Control-Allow-Origin`, and resolves for *any* HTTP status when it
 * does — which matters, because some stations answer 401 to a bare probe while
 * still being perfectly CORS-clean for the audio element. We abort as soon as
 * the headers land so we never pull stream bytes.
 */
export async function probeStream(rawUrl: string, timeoutMs = 6000): Promise<ProbeResult> {
  const plan = planUrl(rawUrl)
  if (plan.blockedReason) {
    return { capability: 'unavailable', url: plan.url, reason: plan.blockedReason }
  }

  // The main process serves local files itself, CORS-clean; a browser has no
  // way to reach the disk at all.
  if (isLocalFile(plan.url)) {
    return isDesktop
      ? { capability: 'full', url: plan.url }
      : { capability: 'unavailable', url: plan.url, reason: 'Local files play only in the desktop app.' }
  }

  // Every response is made CORS-clean by the main process, so there is nothing
  // to probe: the full pipeline is available for every station that plays.
  if (isDesktop) {
    return { capability: 'full', url: plan.url }
  }

  if (plan.isHls) {
    // hls.js fetches segments itself and hands the element a same-origin
    // MediaSource blob, so the element is never tainted. Its own segment
    // requests still need CORS, but that surfaces as a load error, not silence.
    if (canUseMseHls()) return { capability: 'full', url: plan.url }

    // Without MSE — iPhone Safari, notably — hls.js steps aside and the element
    // plays the playlist natively, fetching every resource itself under the
    // ordinary cross-origin rules. Probing cannot help: the playlist's headers
    // say nothing about the segments that follow. Keep it off the graph.
    return {
      capability: 'playback-only',
      url: plan.url,
      reason: 'This browser plays HLS natively, which bars Web Audio. Equalizer and visualizer unavailable.',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(plan.url, {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal,
      // Streams are unbounded; never let the browser cache one.
      cache: 'no-store',
      headers: { Range: 'bytes=0-1' },
    })
    // We only ever wanted the headers.
    void res.body?.cancel().catch(() => {})
    return { capability: 'full', url: plan.url }
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        capability: 'unknown',
        url: plan.url,
        reason: 'Server did not respond in time.',
      }
    }
    // A CORS rejection and a hard network failure are indistinguishable from
    // script — the spec deliberately hides which. Assume the friendlier of the
    // two and let playback itself decide: if the stream is simply dead, the
    // plain element will report an error a moment later.
    return {
      capability: 'playback-only',
      url: plan.url,
      reason: plan.upgraded
        ? 'No https version of this stream, or it blocks Web Audio. Equalizer unavailable.'
        : 'This server does not permit Web Audio access. Equalizer and visualizer unavailable.',
    }
  } finally {
    clearTimeout(timer)
  }
}
