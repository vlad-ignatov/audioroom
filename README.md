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

- [Features](#features)
- [Download](#download)
- [Building from source](#building-from-source)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

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
  ([how](docs/how-it-works.md#local-files)).
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

## Download

Get the latest version for macOS, Windows or Linux from the
[Releases page](https://github.com/vlad-ignatov/audioroom/releases/latest).
The packages aren't signed with a paid certificate, so the first launch
needs one extra step on each system; [Installing](docs/installing.md#first-launch)
explains it.

AudioRoom is developed on macOS and tested on Linux. It is expected to work
on Windows, where the test suite runs, but no person has used it there yet.
If you try it, please [open an issue](https://github.com/vlad-ignatov/audioroom/issues)
and say whether it works.

## Building from source

With [Node.js](https://nodejs.org/) 22.12 or newer:

```bash
git clone https://github.com/vlad-ignatov/audioroom.git
cd audioroom
npm install
npm run dev:app
```

[Development](docs/development.md) covers the other commands, tests and
building installers.

## Documentation

- [Installing](docs/installing.md): first launch on each system, the Linux
  applications menu, ffmpeg for WMA and ALAC, where your data is kept.
- [Development](docs/development.md): commands, tests, building packages,
  releasing, project layout.
- [How it works](docs/how-it-works.md): the audio engine, the signal chain,
  loudness leveling, now-playing detection, and the measurements behind them.
- [Roadmap](ROADMAP.md): what's planned, and where help is most welcome.

## Contributing

Contributions are welcome, and testing on Windows is the most useful start.
Before opening a pull request,
run `npm run typecheck` and `npm test`. [AGENTS.md](AGENTS.md) covers the
rules that are easy to break, for people and coding agents alike.

## Acknowledgements

Station data comes from [radio-browser.info](https://www.radio-browser.info/),
a community-maintained directory of internet radio.

## License

[MIT](LICENSE) © Vladimir Ignatov
