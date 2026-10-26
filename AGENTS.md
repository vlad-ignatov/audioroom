# Notes for coding agents

AudioRoom is an Electron desktop player for internet radio and local music
files: React 19, TypeScript, Vite, zustand, Web Audio. The README explains
the design ("How it works"); this file covers what you need to change it
safely. ROADMAP.md lists what's planned.

## Commands

| Command | Use |
|---|---|
| `npm run dev:app` | Run the app with hot reload |
| `npm run typecheck` | The only automated check. Run it before every commit |
| `npm run package:unpacked` | Build the real app for this computer, without an installer |
| `npm run icons` | Regenerate every icon size after editing `build/icon.svg` |

There is no test runner and no linter. Check behavior in the running app.

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

## Testing in the running app

- Don't steal focus. If you launch the app or a test window, keep it
  hidden or inactive: the user may be typing, and Space toggles playback.
- Some agent shells set `ELECTRON_RUN_AS_NODE=1` (VS Code's does), which
  makes `require('electron')` return a path instead of the API. Unset it
  for Electron commands: `env -u ELECTRON_RUN_AS_NODE npm run dev:app`.
- Don't test against the user's real data folder. Copy it and point
  `app.setPath('userData', …)` at the copy.

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
