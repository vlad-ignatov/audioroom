## Which file to download

| System | File |
|---|---|
| macOS, Apple Silicon | `…-mac-arm64.dmg` |
| macOS, Intel | `…-mac-x64.dmg` |
| Windows (x64), never tested | `…-win-x64.exe` |
| Linux (x64) | `…-linux-x86_64.AppImage` |

The packages aren't signed with a paid developer certificate, so the first
launch needs one extra step:

- **macOS:** after the "could not verify" message, open System Settings →
  Privacy & Security and click **Open Anyway**. Or run
  `xattr -dr com.apple.quarantine /Applications/AudioRoom.app` once.
- **Windows:** in the SmartScreen message, click **More info**, then
  **Run anyway**.
- **Linux:** `chmod +x` the AppImage and run it. Ubuntu 22.04 and newer
  need `libfuse2` (`libfuse2t64` on 24.04). To add it to the applications
  menu with its icon, see
  [Installing](https://github.com/vlad-ignatov/audioroom/blob/main/docs/installing.md#adding-audioroom-to-the-linux-applications-menu).

WMA files, and ALAC and AIFF outside macOS, need
[ffmpeg](https://github.com/vlad-ignatov/audioroom/blob/main/docs/installing.md#playing-wma-alac-and-aiff-files-ffmpeg).
