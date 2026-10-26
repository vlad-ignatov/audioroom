# Installing and running AudioRoom

- [Which file to download](#which-file-to-download)
- [First launch](#first-launch)
- [Adding AudioRoom to the Linux applications menu](#adding-audioroom-to-the-linux-applications-menu)
- [Playing WMA, ALAC and AIFF files (ffmpeg)](#playing-wma-alac-and-aiff-files-ffmpeg)
- [Where your data is kept](#where-your-data-is-kept)
- [Platform differences](#platform-differences)

## Which file to download

From the [Releases page](https://github.com/vlad-ignatov/audioroom/releases/latest):

| System | File |
|---|---|
| macOS, Apple Silicon | `AudioRoom-<version>-mac-arm64.dmg` |
| macOS, Intel | `AudioRoom-<version>-mac-x64.dmg` |
| Windows (x64) | `AudioRoom-<version>-win-x64.exe` |
| Linux (x64) | `AudioRoom-<version>-linux-x86_64.AppImage` |

## First launch

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

## Adding AudioRoom to the Linux applications menu

An AppImage carries its icon and menu entry inside, where file managers and
menu editors don't look. [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever)
and AppImageLauncher add both to the menu for you. To do it by hand, set
`APPIMAGE` to where you keep the file and run:

```bash
APPIMAGE=~/Applications/AudioRoom-0.1.0-linux-x86_64.AppImage

cd "$(mktemp -d)"
"$APPIMAGE" --appimage-extract 'usr/share/icons/hicolor/512x512/apps/audioroom.png'
install -D squashfs-root/usr/share/icons/hicolor/512x512/apps/audioroom.png \
  ~/.local/share/icons/hicolor/512x512/apps/audioroom.png

cat > ~/.local/share/applications/audioroom.desktop <<EOF
[Desktop Entry]
Type=Application
Name=AudioRoom
Comment=Internet radio and music player
Exec="$APPIMAGE" %U
Icon=audioroom
StartupWMClass=audioroom
Categories=AudioVideo;
EOF
```

Keep the file name `audioroom.desktop` and the `StartupWMClass` line: they
tie the running window to the menu entry, so the dock doesn't show it as a
second, unknown app.

## Playing WMA, ALAC and AIFF files (ffmpeg)

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

Each file is converted once, in the background, and the result is cached.

## Where your data is kept

The station library, local folders, play queue and settings (equalizer,
effects, leveling, table layout) are all in one SQLite database,
`library.sqlite`, in the app's data folder:

| Platform | Folder |
|---|---|
| macOS | `~/Library/Application Support/AudioRoom` |
| Linux | `~/.config/AudioRoom` |
| Windows | `%APPDATA%\AudioRoom` |

Copying that folder to another machine moves everything. To move just the
station library and sound setup, use the backup in the app instead.

Your music files are only read, except when you edit their tags.
Conversions of ALAC, AIFF, CAF and WMA files are cached in `transcoded/`
inside the same folder, and can be deleted at any time.

## Platform differences

| Platform | Status |
|---|---|
| macOS | Developed and tested |
| Linux | Tested |
| Windows | Expected to work. The test suite runs on Windows in CI, but no person has used the app there yet. |

If you try AudioRoom on Windows, please
[open an issue](https://github.com/vlad-ignatov/audioroom/issues) and say
whether it works, even if everything was fine.

Two features only exist on macOS, because the problems they fix are macOS
problems:

- Finding network shares that macOS has remounted under a new name
  (`/Volumes/Music-1`).
- Removing the `._` files macOS leaves on network shares after tags are
  edited.
