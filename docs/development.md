# Development

- [Getting started](#getting-started)
- [Commands](#commands)
- [Tests](#tests)
- [Building packages](#building-packages)
- [Releasing](#releasing)
- [Project layout](#project-layout)

[AGENTS.md](../AGENTS.md) lists the rules that are easy to break, such as
where settings and user actions belong. Read it before a first change.

## Getting started

You need [Node.js](https://nodejs.org/) 22.12 or newer, with npm (Node
20.19 or a later 20.x release also works), and optionally
[ffmpeg](installing.md#playing-wma-alac-and-aiff-files-ffmpeg).

```bash
git clone https://github.com/vlad-ignatov/audioroom.git
cd audioroom
npm install
npm run dev:app
```

`dev:app` starts the Vite dev server on port 5199 and Electron beside it,
with hot reload for the interface. Changes in `electron/` need a restart.

To try a change against a copy of your real library rather than the
library itself, start the app with `AUDIOROOM_DATA_DIR=/path/to/copy`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev:app` | Runs the app with hot reload (Vite dev server plus Electron) |
| `npm run dev` | Runs the interface in a browser only. Radio works; the local library needs the desktop app. |
| `npm run typecheck` | Type-checks the project, tests included |
| `npm test` | Runs the unit tests |
| `npm run test:watch` | Runs the unit tests on every change |
| `npm run test:e2e` | Builds the app and runs the end-to-end tests in Electron |
| `npm run package:mac` | Builds the macOS `.dmg` files (Apple Silicon and Intel) into `release/` |
| `npm run package:win` | Builds the Windows installer (x64) into `release/` |
| `npm run package:linux` | Builds the Linux AppImage (x64) into `release/` |
| `npm run package:unpacked` | Builds the app for this computer without an installer, to try it quickly |
| `npm run icons` | Regenerates every app icon size from `build/icon.svg` |

## Tests

Run `npm run typecheck` and `npm test` before every commit. CI runs both,
the build and the end-to-end tests on macOS, Linux and Windows for every
push and pull request.

- `tests/unit/`: the interface's logic in plain Node: parsers, loudness
  math, settings.
- `tests/main/`: the main process, also without Electron: the database,
  the `media://` handler, tag writing.
- `tests/e2e/`: the built app, started by Playwright on a temporary data
  folder with its window hidden.

The audio graph itself (equalizer, limiter, effects) needs a real
AudioContext, so it is checked by ear in the running app.

## Building packages

`npm run package:unpacked` is the quick way to try the real app: it
builds for this computer, without an installer, into `release/`
(`release/mac-arm64/AudioRoom.app` on an Apple Silicon Mac).

Installers can only be built on some systems:

| Package | on macOS | on Linux | on Windows |
|---|---|---|---|
| macOS | ✓ | ✗ | ✗ |
| Windows | ✓ (Apple Silicon: needs Rosetta 2) | ✓ | ✓ |
| Linux | ✓ (Apple Silicon: needs Rosetta 2) | ✓ | ✗ |

`package:mac`, `package:win` and `package:linux` check this first and stop
with an explanation instead of failing partway through the build. On an
Apple Silicon Mac, install Rosetta 2 once with
`softwareupdate --install-rosetta --agree-to-license`: the tools that build
the Windows installer and the AppImage are Intel programs.

## Releasing

The Release workflow (`.github/workflows/release.yml`) builds all three
packages, each on its own system.

1. Bump `version` in `package.json` and commit.
2. Push a matching tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow creates a draft release with the packages attached and
   `.github/release-notes.md` at the top. Review it and publish.

Running the workflow by hand (Actions → Release → Run workflow, on `main`)
only builds the packages, and leaves them as downloads on the run's page.

## Project layout

```
electron/        main process: window, menus, context menus,
                 media:// file serving and conversion, SQLite
                 library and settings, tag writing
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
tests/           unit, main-process and end-to-end tests
scripts/         icon generation, build host checks
```

[How it works](how-it-works.md) explains the audio engine and the design
decisions behind it.
