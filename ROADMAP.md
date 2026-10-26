# Roadmap

What's planned for AudioRoom, and where help is most welcome. Nothing
here has a date. If you'd like to take something on, open an issue first,
so two people don't build the same thing.

## Windows testing

AudioRoom should run on Windows, and CI runs the test suite there, but
no person has used it yet. A report is useful even if everything works.
Things worth checking:

- The installer from `npm run package:win`, and starting the app.
- Radio: searching, playing, the equalizer and the visualizer.
- Local files: adding folders, playing, seeking, editing MP3 tags.
- Media keys and the window title following the current track.
- WMA and ALAC files with ffmpeg installed, and without it.

## Light theme, and following the system

The interface is dark only. The plan:

- A light theme, as a second set of the color tokens in `src/index.css`.
- A setting: Dark, Light or Match system. Match system follows the OS,
  through `prefers-color-scheme` in the page and Electron's `nativeTheme`
  for the native menus and title bar.
- Optionally, the system's accent color instead of amber. Electron reads
  it on macOS and Windows (`systemPreferences.getAccentColor()`).

## More drag and drop

In progress. Today you can reorder stations, drag tracks and folders from
the library tree or your file manager into the play queue, and reorder
the queue. Next ideas:

- Drop folders or files onto the library tree to add them to the library.
- Drop M3U and PLS playlists onto the window to import their stations.
- Drag tracks out of the app, to a folder or another app.

## More context menus

Right-click works on station rows, the library tree and the play queue.
Every action is a command in `src/commands/`, and an element offers
commands with `commandScope()`, so a new menu is mostly a list of
existing commands. Places still without one: the player bar, the
equalizer and its presets, the filter sidebar, and the table's column
headers (to show or hide columns).

## Portable version

One folder on a USB drive, with the macOS, Windows and Linux builds side
by side and one shared library. The groundwork is there (settings now
live in the SQLite database, next to the library). What's left:

- Look for a data folder next to the app at startup, and keep the
  library there instead of in the user's profile.
- Save paths of music on the same drive relative to it. The drive has a
  different path on each OS (`/Volumes/STICK`, `E:\`, `/media/…/STICK`).
- Builds: a universal macOS app, Electron Builder's portable Windows
  `.exe`, and the AppImage, assembled into one folder.

## Also wanted

- **"Add to applications menu" on Linux.** An AppImage's icon and menu
  entry stay inside it, so today people
  [install them by hand](docs/installing.md#adding-audioroom-to-the-linux-applications-menu).
  A command, offered only when running as an AppImage, could write
  `audioroom.desktop` and the icon into `~/.local/share`, with `Exec`
  pointing at `$APPIMAGE`, and update them when the file moves.

- **Track titles for HLS stations.** They carry the title as ID3 data
  inside the stream, which `hls.js` reports but the app doesn't read yet.
