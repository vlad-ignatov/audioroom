<p align="center">
  <img src="build/icons/128x128.png" width="96" height="96" alt="">
</p>

<h1 align="center">AudioRoom</h1>

<p align="center">
  A desktop player for internet radio and your own music files, with a 10-band
  equalizer, loudness leveling, room effects and a live spectrum visualizer.
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="AudioRoom: the station library, with the equalizer open and the spectrum visualizer in the player bar" width="1000">
</p>

## Features

**Internet radio**

- Search about 50,000 stations from [radio-browser.info](https://www.radio-browser.info/)
  and add them to your library. HLS streams are supported.
- A sortable, filterable station table, with columns you can reorder,
  favorites and saved views.
- The current artist and title, where the station broadcasts them. They are
  shown in the window title and in the OS media controls.
- Import M3U and PLS playlists. Back up the whole library and sound setup
  to a file, and restore it on another machine.

**Local music**

- Add folders and single files, and browse them as a tree with tags,
  duration, codec, bitrate and cover art.
- Plays MP3, AAC, FLAC, Ogg Vorbis, Opus, WAV and WebM directly. ALAC, AIFF,
  CAF and WMA files are converted once in the background, then played
  ([see below](#local-files)).
- A play queue next to the tree. Drag in files or folders from the tree or
  from your file manager, reorder by dragging, and shuffle. The queue is kept
  between sessions.
- Edit MP3 title, artist and album, for one file or a whole folder. A repair
  tool fixes Cyrillic tags that were saved in the wrong encoding.

**Sound**

- A 10-band equalizer with built-in presets, and your own.
- A multiband limiter stops equalizer boosts from clipping without turning
  down the whole mix. The visualizer turns red where it is working.
- Loudness leveling (ITU-R BS.1770) brings stations and tracks to a similar
  volume.
- Reverb with five synthesized rooms, and a stereo width control.

**Desktop**

- Native menus and right-click menus, media keys and OS media controls.
- Keyboard shortcuts for everything common. <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>/</kbd>
  lists them.

## Platforms

| Platform | Status | Package |
|---|---|---|
| macOS | Developed and tested | `.dmg` (Apple Silicon and Intel) |
| Linux | Tested | AppImage |
| Windows | **Expected to work, but never tested** | NSIS installer |

Nothing in the code is tied to macOS or Linux, and electron-builder is set up
to build a Windows installer, but no one has run it on Windows yet. If you
try it, please [open an issue](https://github.com/vlad-ignatov/audioroom/issues)
and say whether it works, even if everything was fine.

Two features only run on macOS, because the problems they fix are macOS
problems:

- Finding network shares that macOS has remounted under a new name
  (`/Volumes/Music-1`).
- Removing the `._` files macOS leaves on network shares after tags are edited.

## Download

Get the latest version from the
[Releases page](https://github.com/vlad-ignatov/audioroom/releases/latest):

| System | File |
|---|---|
| macOS, Apple Silicon | `AudioRoom-<version>-mac-arm64.dmg` |
| macOS, Intel | `AudioRoom-<version>-mac-x64.dmg` |
| Windows (x64) | `AudioRoom-<version>-win-x64.exe` |
| Linux (x64) | `AudioRoom-<version>-linux-x86_64.AppImage` |

The packages aren't signed with a paid developer certificate, so each
system warns you the first time:

- **macOS** says it "could not verify" AudioRoom. Close the message, open
  System Settings → Privacy & Security, and click **Open Anyway** next to
  AudioRoom. Or run `xattr -dr com.apple.quarantine /Applications/AudioRoom.app`
  once.
- **Windows** SmartScreen says it "protected your PC". Click **More info**,
  then **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x AudioRoom-*.AppImage`)
  and run it. On Ubuntu 22.04 and newer, AppImages need `libfuse2`
  (`libfuse2t64` on 24.04).

## Building from source

You need:

- [Node.js](https://nodejs.org/) 22.12 or newer, with npm. Node 20.19 or a
  later 20.x release also works.
- Optionally, [ffmpeg](https://ffmpeg.org/) (see below).

```bash
git clone https://github.com/vlad-ignatov/audioroom.git
cd audioroom
npm install
npm run dev:app
```

| Command | What it does |
|---|---|
| `npm run dev:app` | Runs the app with hot reload (Vite dev server plus Electron) |
| `npm run dev` | Runs the interface in a browser only. Radio works; the local library needs the desktop app. |
| `npm run typecheck` | Type-checks the project |
| `npm run package:mac` | Builds the macOS `.dmg` files (Apple Silicon and Intel) into `release/` |
| `npm run package:win` | Builds the Windows installer (x64) into `release/` |
| `npm run package:linux` | Builds the Linux AppImage (x64) into `release/` |
| `npm run package:unpacked` | Builds the app for this computer without an installer, to try it quickly |
| `npm run icons` | Regenerates every app icon size from `build/icon.svg` |

### Which packages you can build where

| Package | on macOS | on Linux | on Windows |
|---|---|---|---|
| macOS | ✓ | ✗ | ✗ |
| Windows | ✓ (Apple Silicon: needs Rosetta 2) | ✓ | ✓ |
| Linux | ✓ (Apple Silicon: needs Rosetta 2) | ✓ | ✗ |

`package:mac`, `package:win` and `package:linux` check this first and stop
with an explanation instead of failing partway through the build. On an Apple Silicon Mac,
install Rosetta 2 once with
`softwareupdate --install-rosetta --agree-to-license`: the tools that build
the Windows installer and the AppImage are Intel programs.

### Optional: ffmpeg

Most formats play without anything extra. [ffmpeg](https://ffmpeg.org/) is
only needed to convert a few that Chromium cannot play. It is not bundled
with the app.

| Format | macOS | Linux and Windows |
|---|---|---|
| WMA | needs ffmpeg | needs ffmpeg |
| ALAC, AIFF, CAF | built in (`afconvert`) | needs ffmpeg |

Without ffmpeg, those files show "Playing WMA files needs ffmpeg, which is
not installed" instead of playing. Install it, then play the file again.

- **macOS:** `brew install ffmpeg`. The app finds Homebrew and MacPorts
  installs even when it is opened from the Dock, without a restart.
- **Linux:** install ffmpeg from your distribution's package manager.
- **Windows:** `winget install Gyan.FFmpeg`, or put `ffmpeg.exe` on your
  `PATH` yourself. Restart the app afterwards so it sees the new `PATH`.

## Where your data is kept

The station library, local folders and play queue are stored in a SQLite
database, `library.sqlite`, in the app's data folder:

| Platform | Folder |
|---|---|
| macOS | `~/Library/Application Support/AudioRoom` |
| Linux | `~/.config/AudioRoom` |
| Windows | `%APPDATA%\AudioRoom` |

Equalizer, effects, leveling and table settings are kept in the same folder,
in Chromium's local storage. Your music files are only read, except when you
edit their tags. ALAC, AIFF, CAF and WMA conversions are cached in
`transcoded/` inside the same folder.

---

## How it works

The rest of this file is for anyone who wants to know how it works. It also
records several things that were measured rather than assumed.

### Two audio elements

An equalizer and a visualizer both need the Web Audio API, and Web Audio may
only process a stream whose server sends an `Access-Control-Allow-Origin`
header. A cross-origin stream without one does not raise an error when routed
through an audio graph. It plays **silence**. Worse,
`createMediaElementSource()` binds an element to the graph *permanently*.

So the engine keeps two audio elements for the life of the window:

- `graphEl` is bound to Web Audio, and carries every station that allows it.
- `plainEl` is **never** passed to Web Audio. A station that can't go through
  the graph still plays on it, with the equalizer and visualizer shown inert
  and the reason given, rather than playing silence.

This comes from the project's start as a browser app, where it mattered: of
250 of the most-played stations in the directory, 42% were served over plain
http, which an https page blocks outright, and some of the rest refused CORS.
The desktop app removes both problems. Its main process adds the CORS header
to every response, so in practice every station that plays gets the full
audio graph. The second element and the probe stay as a safety net, and the
probe still catches dead hosts before playback.

### The signal chain

```mermaid
flowchart TD
    G["graphEl<br/>routed through Web Audio"] --> S[source]
    S -. measured by .-> M[loudness meter]
    S --> L["level gain<br/>(loudness leveling)"]
    L --> P[preamp]
    P --> FX["EQ → Reverb → Width<br/>(each can be bypassed)"]
    FX --> LIM[multiband limiter]
    LIM -. read by .-> A["analyzer<br/>(visualizer)"]
    LIM --> V[volume]
    V --> SP([speakers])
    PE["plainEl<br/>never touches Web Audio"] --> SP
```

Each effect is a *stage*, addressed only by its input and output nodes.
Bypassing one means leaving it out of the chain and reconnecting the rest,
without special cases for its wiring. Every link between stages starts at the
preamp or at a stage's output, so disconnecting exactly those leaves each
stage's internal wiring intact.

The visualizer reads the end of the chain, before the volume control. It shows
the station as leveled, equalized and limited, and does not shrink when you
turn the volume down.

### Equalizer and limiter

Bands sit at the ISO octave centers (31 Hz to 16 kHz), Q ≈ 1.414 for one-octave
bandwidth, ±12 dB. Band 0 is a low shelf and band 9 a high shelf, so the
extremes move real energy.

Boosting a band of a track mastered to full scale pushes its peaks over
0 dBFS, and something has to hold them. A full-band limiter does it by
turning the whole mix down, so a boosted kick drum ducks the vocals with it.
Here the signal is split by Linkwitz–Riley crossovers at 150 Hz and 4 kHz,
each band is limited on its own, and the bands are summed into a soft
clipper. A bass hit that would clip pulls down only the bass. The crossovers
sum back to a flat response, so the stage changes nothing audible until it has
to act. The built-in presets lower the preamp so their boosts have room.

### Loudness leveling

Loudness follows ITU-R BS.1770: K-weighting, 400 ms blocks and two-stage gating.

- **Local files** are decoded and measured whole, never by their opening
  seconds. Quiet intros made loud songs get boosted by 12 dB. The next track
  in the queue is measured while the current one plays, so it starts at the
  right level.
- **Streams** are measured on the few seconds the server sends on connect.
  That burst is the same for every listener and was found to be 2–5 dB off a
  30-second reading. It is a starting point only:
  - an unconfirmed reading may boost by at most 6 dB;
  - one 20-second live check then corrects it if it is off by more than 2 LU,
    and after that the level stays put;
  - each station's level is remembered for next time.

### Space effects

The effects rack beside the equalizer adds two effects. Both are in the same
graph, so the same CORS rule applies to them.

- **Reverb**: a `ConvolverNode` fed an impulse response *synthesized at
  runtime* (Room, Club, Hall, Cathedral, Plate). There are no `.wav` assets,
  and room size is a live control. Plain decaying white noise sounds like
  hiss, so each impulse response also gets a one-pole lowpass whose cutoff
  falls across the tail (real rooms absorb treble faster than bass), plus
  discrete early reflections at the front, which is most of what tells the
  ear how big a space is. Dry/wet uses an equal-power crossfade. A linear one
  dips in loudness at the midpoint, because the two signals are uncorrelated
  and sum by power.
- **Stereo width**: a mid-side matrix: `mid = (L+R)/2`, `side = (L-R)/2`,
  `out = mid ± side × width`. Width 1 passes the signal through bit-exact,
  0 is mono, and above 1 is exaggerated. The input is forced to two channels,
  so a mono stream is upmixed instead of landing entirely in the left speaker.

An HRTF `PannerNode` for 3D placement was built and then removed. On radio
material it sounded like a novelty, not something anyone would leave on, and
it only worked properly on headphones.

Measured on the live chain:

- Width 0 gives an L/R correlation of **1.000** (true mono).
- Width 1 gives **0.800**, against the bypassed source's **0.817**: a real
  passthrough.
- Width 1.5 and 2.0 widen it to **0.557** and **0.274**.

All five impulse responses have decorrelated channels (|r| < 0.01), and
every generated tail decays steadily.

### Local files

The renderer cannot load `file://` media, so files are served through a private
`media://` scheme. Its handler answers Range requests, which is what makes
seeking work, and sends permissive CORS headers so files go through the same
audio graph as radio.

Chromium has no decoder for ALAC or WMA, and cannot read AIFF, CAF or ASF
files. Files it cannot play are converted once into a cache, and the handler
serves the converted file at the original URL:

- lossless sources become FLAC, so nothing is lost;
- WMA becomes Opus, at a bitrate above the source's.

The renderer never sees the difference: same URL, same seeking, same audio
graph.

### Now playing

A media element has no way to report the current track, so the player tries
two independent sources and remembers which one worked for each station:

1. **A status endpoint** on the stream's own host: `/status-json.xsl`,
   `/stats?json=1` or `/currentsong?sid=1`. It costs a few kilobytes, and the
   request has no custom header, so no CORS preflight is needed.
2. **ICY metadata inside the stream.** This requires the `Icy-MetaData: 1`
   request header, which is **not** CORS-safelisted. That triggers a
   preflight, which many stream servers never answer: of six stations tested,
   three answered it and three refused. Where it works, the byte stream is
   scanned for `StreamTitle='...'` rather than read at the `icy-metaint`
   offset, because most servers do not expose that header to scripts anyway.

Measured across the starter library:

| station | source | result |
|---|---|---|
| Heart 80s | ICY | artist and title |
| WALM Vinyl HD | status | title |
| Damar Türk FM | status | artist and title |
| Dance Wave! | status | a station slogan, not a track |
| Aardvark Blues FM | none | nothing available |

Roughly half of stations expose a usable track. Aardvark is the instructive
case: `curl` *can* read its ICY metadata, but a browser cannot, because the
server does not answer the preflight.

The cost is bounded:

- The ICY scan gives up after 96 KB. In practice a title turns up within
  15–55 KB.
- The status endpoint costs a few KB.
- Polling runs every 25 s and pauses while the window is hidden.
- A station that returns nothing twice is not polled again.

Some stations put something other than a song in the title field: a slogan,
a tracklist URL or an internal id. Only empty strings and strings with no
letters at all are filtered out. Anything else is shown as broadcast, rather
than guessed at.

HLS stations carry track data as ID3 tags inside the stream instead, which
`hls.js` reports separately. That is not wired up yet.

### Other notes

- `stalled` is not treated as a failure. Chrome fires it whenever no data
  arrives for about 3 s, which is routine while a live stream connects.
  Reloading on it cancels the pending `play()` and kills connections that
  were about to succeed. A 25-second watchdog catches stations that are
  really stuck.
- Plays are reported back to radio-browser.info, so its popularity rankings
  stay useful.

## Project layout

```
electron/        main process: window, menus, context menus,
                 media:// file serving and conversion, SQLite
                 library, tag writing
src/audio/       engine (graph, stages, routing), equalizer,
                 limiter, loudness, effects, stream probe, now
                 playing
src/commands/    every user action, defined once: menus,
                 shortcuts and buttons all run commands by id
src/store/       zustand stores: station library, local library,
                 play queue, player, equalizer, effects,
                 leveling, table, interface
src/components/  station table, library tree and queue,
                 equalizer, effects, visualizer, player bar,
                 dialogs
src/api/         radio-browser.info client
```

## Acknowledgements

Station data comes from [radio-browser.info](https://www.radio-browser.info/),
a community-maintained directory of internet radio.

## Contributing

Contributions are welcome. [ROADMAP.md](ROADMAP.md) lists what's planned and
where help is most needed; testing on Windows is the most useful start.

## License

[MIT](LICENSE) © Vladimir Ignatov
