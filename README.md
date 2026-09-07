# Player

An online-radio player that runs entirely in the browser: a searchable, sortable,
customisable station library, a 10-band equalizer, and a live frequency
visualizer. TypeScript + React 19 + Vite 8, no backend.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
```

## The constraint that shapes the design

An equalizer and a visualizer both need the Web Audio API, and Web Audio may
only touch a stream whose server sends an `Access-Control-Allow-Origin` header.
A cross-origin stream without one does not raise an error when routed through an
audio graph — it outputs **silence**. Worse, `createMediaElementSource()` binds
an element to the graph *permanently* and cannot be undone.

So the engine keeps two audio elements for the life of the page:

- `graphEl` — bound to Web Audio, carries stations whose servers allow it
- `plainEl` — **never** passed to the Web Audio API, carries the rest

Each station is probed before playback and routed to whichever element its
server permits. Stations on the plain path still play; the EQ and visualizer are
shown inert with the reason, rather than silently doing nothing.

```
graphEl ─ MediaElementSource ─ preamp ─┬─ EQ ─ Reverb ─ Width ─┬─ output ─ Analyser ─ speakers
plainEl ──────────────────────────────┴─────(each bypassable)──┴──────────────────── speakers
```

Each effect is a *stage* addressed only by its input and output nodes. Bypassing
one means leaving it out of the chain and reconnecting, rather than special-casing
its wiring — every inter-stage link starts at the preamp or a stage output, so
disconnecting exactly those leaves each stage's internals intact.

Bands sit at the ISO octave centres (31 Hz … 16 kHz), Q ≈ 1.414 for one-octave
bandwidth, ±12 dB, with band 0 a low shelf and band 9 a high shelf so the
extremes move real energy. A preamp ahead of the chain recovers headroom when
boosting.

## Space effects

The rack beside the equalizer adds two effects, both in the same graph and so
subject to the same CORS rule:

- **Reverb** — a `ConvolverNode` fed an impulse response *synthesised at
  runtime* (Room, Club, Hall, Cathedral, Plate), so there are no `.wav` assets
  and room size is a live control. Plain decaying white noise sounds like hiss,
  so each IR also gets a one-pole lowpass whose cutoff falls across the tail
  (real rooms absorb treble faster than bass) plus discrete early reflections at
  the front, which is most of what tells the ear how big a space is. Dry/wet uses
  an equal-power crossfade; a linear one dips in loudness at the midpoint because
  the two signals are uncorrelated and sum by power.
- **Stereo width** — a mid-side matrix: `mid = (L+R)/2`, `side = (L-R)/2`,
  `out = mid ± side × width`. Bit-exact passthrough at 1, mono at 0, exaggerated
  above. Its input is forced to two channels so a mono stream upmixes instead of
  landing entirely in the left speaker.
An HRTF `PannerNode` for 3D placement was built and then removed: on radio
material it read as a novelty rather than something anyone would leave on, and it
only worked properly on headphones.

Measured on the live chain: width 0 gives L/R correlation **1.000** (true mono),
width 1 gives **0.800** against the bypassed source's **0.817** (a real
passthrough), and 1.5 / 2.0 widen to **0.557** / **0.274**. All five impulse
responses are channel-decorrelated (|r| < 0.01), and every generated tail decays
monotonically.

## What was measured, not assumed

Against 250 of the directory's most-played stations, probed with a browser
User-Agent:

| | share | consequence |
|---|---|---|
| Served over `https` | 58% | usable on a deployed https site |
| **`http` only** | **42%** | **blocked as mixed content in production** |
| Of the https ones, CORS-enabled | **92%** | equalizer and visualizer work |
| Genuinely CORS-refusing | 1% | plays, but no EQ — the `plainEl` path |

Two things worth knowing:

- **Plain-http streams, not CORS, are the real limitation.** Nothing in the
  browser can fix them; only a proxy can, which this app deliberately does not
  have. Each `http://` URL is retried over `https://`, which rescues a good
  share; the rest are marked *Blocked*.
- **On `http://localhost` everything works**, because mixed-content blocking
  only applies to https pages. The app will look perfectly healthy in
  development and lose those stations the day it is deployed. The quality badge
  on every row exists so this is visible from the start.

Some servers vary their response by User-Agent — one station refuses `curl`
outright while returning `Access-Control-Allow-Origin: *` to a browser. Station
capability is therefore determined at play time from the browser itself, and
cached for 24 hours rather than permanently.

## Verified behaviour

Driven through the Chrome DevTools Protocol against live servers:

| station | capability | pipeline | analyser |
|---|---|---|---|
| CORS-clean MP3 | `full` | graph | signal present |
| HLS (`.m3u8`) | `full` | graph | signal present |
| CORS-refusing ×2 | `playback-only` | plain | n/a — still plays |
| Dead host | `unavailable` | — | error surfaced |

HLS is immune to both problems: `hls.js` feeds the element a same-origin
MediaSource blob, so the EQ always works there.

## Now playing

There is no way to get the current track from a media element, so the player
tries two independent routes and remembers which one worked for a station:

1. **A status endpoint** — `/status-json.xsl`, `/stats?json=1`,
   `/currentsong?sid=1` on the stream's own host. A few kilobytes, and no custom
   request header, so it needs no CORS preflight.
2. **ICY in-stream metadata** — requires the `Icy-MetaData: 1` request header,
   which is **not** CORS-safelisted. That triggers a preflight, and many stream
   servers never answer it. Of six stations tested, three responded to the
   preflight and three refused. Where it works we scan the byte stream for
   `StreamTitle='...'` rather than honouring `icy-metaint`, whose header most
   servers do not expose to script anyway.

Measured across the starter library:

| station | route | result |
|---|---|---|
| Heart 80s | ICY | artist and title |
| WALM Vinyl HD | status | title |
| Damar Türk FM | status | artist and title |
| Dance Wave! | status | a station slogan, not a track |
| Aardvark Blues FM | — | nothing available |

Roughly half of stations expose a usable track. Aardvark is the instructive
case: `curl` *can* read its ICY metadata, but a browser cannot, because the
server does not answer the preflight. That is a browser restriction, not a
missing feature.

Cost is bounded: the ICY scan aborts after 96 KB (in practice a title turns up
in 15–55 KB), the status route costs a few KB, polling is every 25 s, it pauses
while the tab is hidden, and a station that returns nothing twice stops being
polled at all. The track is also pushed to the Media Session, so it appears on
OS media controls and the lock screen.

Some stations put something other than a song in the title field — a slogan, a
tracklist URL, or an internal id. Only empty strings and strings with no letters
at all are filtered; anything else is shown as broadcast rather than guessed at.

HLS stations carry track data as in-band ID3 instead, which `hls.js` surfaces
separately. That is not wired up yet.

## Layout

```
src/audio/      engine.ts (graph, stages, routing, retry), eq.ts, fx.ts (impulse
                responses, reverb presets), probe.ts
src/store/      zustand slices: library, eq, fx, player, table — all persisted
src/api/        radio-browser.info directory client
src/components/ library table, equalizer, effects rack, visualizer, player bar, search
```

## Notes

- Station data comes from [radio-browser.info](https://www.radio-browser.info/),
  a community directory of ~50,000 stations. Plays are reported back to it so
  its popularity rankings stay useful.
- Library, EQ presets, column layout, filters and saved views persist to
  `localStorage`.
- Now-playing metadata is read on a separate connection, since nothing about
  the current track is exposed to the `<audio>` element. See below.
- `stalled` is not treated as a failure. Chrome fires it whenever no data
  arrives for ~3 s, which is routine while a live stream connects; reloading on
  it aborts the in-flight `play()` and kills connections that were about to
  succeed. A 25 s watchdog handles genuinely stuck stations instead.
