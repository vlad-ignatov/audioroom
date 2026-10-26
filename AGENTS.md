# Notes for coding agents

AudioRoom is an Electron desktop player for internet radio and local music
files: React 19, TypeScript, Vite, zustand, Web Audio.
docs/how-it-works.md explains the design and docs/development.md the
workflow; this file covers what you need to change it safely. ROADMAP.md
lists what's planned.

## Commands

| Command | Use |
|---|---|
| `npm run dev:app` | Run the app with hot reload |
| `npm run typecheck` | Type-check everything, tests included |
| `npm test` | Unit tests (Vitest), in a second or so |
| `npm run test:e2e` | Build, then run the real app through Playwright |
| `npm run package:unpacked` | Build the real app for this computer, without an installer |
| `npm run icons` | Regenerate every icon size after editing `build/icon.svg` |

Run the typecheck and `npm test` before every commit; CI runs all three
checks on macOS, Linux and Windows. There is no linter.

## Tests

- `tests/unit/`: the interface's logic, in plain Node. Parsers, loudness
  math, settings. Import from `@/…` as the app does.
- `tests/main/`: main-process modules, also in plain Node without Electron:
  the database (on a temporary file), the `media://` handler, tag writing.
  A module exports what its tests need beside `install`.
- `tests/e2e/`: the built app in Electron. `launch()` in `tests/e2e/app.ts`
  starts it on a temporary data folder with the window hidden.

Test what the code promises, not how it does it: the bytes a Range request
returns, what the database loads after a migration. The audio graph itself
(EQ, limiter, effects) needs a real AudioContext and is checked by ear.

## Layout

- `electron/`: the main process (CommonJS, `.cjs`). Window, menus, the
  `media://` file protocol, SQLite, tag writing.
- `electron/preload.cjs` and `src/lib/desktop.ts`: the bridge between the
  two. A new IPC call goes in both, with its type in `DesktopBridge`.
- `src/audio/`: the audio engine and everything in the signal chain.
- `src/commands/`: every user action (see below).
- `src/store/`: zustand stores. `src/components/`: React components.

## Rules that are easy to break

- **User actions are commands.** Define them in `src/commands/` with a
  label, keys and a run function, then run them by id. Buttons, keyboard
  shortcuts, the menu bar, media keys and context menus all go through the
  registry. Don't add a separate keydown handler or a one-off menu item.
  An element offers commands to right-clicks and keys inside it with
  `commandScope()`.
- **Settings go through `src/lib/settings.ts`, never `localStorage`.**
  localStorage belongs to one origin, and the dev server and the packaged
  app have different ones, so settings kept there split or vanish. The
  settings module stores them in SQLite on the desktop.
- **Database changes are migrations.** In `electron/library-db.cjs`, bump
  `SCHEMA_VERSION` and add an `if (version < N)` block. Never edit an
  earlier block: it has already run on users' machines.
- **Paths on disk go through `onDisk()`** (`electron/volumes.cjs`) in the
  main process. macOS can remount a network share under a new name, and
  saved paths still use the old one.
- **Never pass `plainEl` to the Web Audio API.** `createMediaElementSource`
  binds an element for good, and a stream whose server refuses CORS plays
  silence through it. The engine keeps two elements for this reason.
- **The dev server port is fixed at 5199** (`vite.config.ts`, with
  `strictPort`). Electron loads exactly that URL (`DEV_URL` in
  `electron/main.cjs`). Change both or neither.
- **The data folder is named after `productName`.** Renaming the app
  moves where it looks for the library; `electron/data-folder.cjs` carries
  the data over from the old name.

## Platforms

Development and testing happen on macOS and Linux. Windows is expected to
work but has never been tested, so don't assume it. Guard platform-specific
code with `process.platform`, and keep the Windows path working in
principle. `npm run package:mac`, `package:win` and `package:linux` check
first whether this machine can build that package.

## Releases

`.github/workflows/release.yml` builds all three packages, each on its
own OS. To release, bump `version` in `package.json`, commit, and push a
matching tag (`v0.2.0`). The workflow then makes a draft release with
the packages and `.github/release-notes.md` at the top; the maintainer
publishes it. Running the workflow by hand only builds the packages.

## Testing in the running app

- Don't steal focus. If you launch the app or a test window, keep it
  hidden or inactive: the user may be typing, and Space toggles playback.
- Some agent shells set `ELECTRON_RUN_AS_NODE=1` (VS Code's does), which
  makes `require('electron')` return a path instead of the API. Unset it
  for Electron commands: `env -u ELECTRON_RUN_AS_NODE npm run dev:app`.
- Don't test against the user's real data folder. Copy it and start the
  app with `AUDIOROOM_DATA_DIR=/path/to/copy`.

## Writing

- **US English** everywhere: UI text, comments, docs and commit messages
  (color, favorite, leveling, behavior). The Web Audio API's own names,
  like `AnalyserNode`, stay as they are.
- **No em dashes.** Use a comma, colon, parentheses or a new sentence. En
  dashes are fine in ranges (2–5 dB) and as separators (Artist – Title).
- **Comments explain why**, in full sentences: the constraint, the bug it
  prevents, what was measured. Read the surrounding code and match its
  density. Many existing comments still use British spelling and em
  dashes; fix those you touch, but don't sweep files just for that.
- **Commit messages:** a short imperative subject, a blank line, then a
  body saying what changed and why, wrapped at about 72 characters.
