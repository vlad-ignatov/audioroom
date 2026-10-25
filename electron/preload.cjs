// Preload: the only bridge between the renderer and the main process.
//
// Context isolation stays on, so the renderer gets a small frozen surface
// rather than any part of Node. Everything here is additive — the app must
// still run in a plain browser during development, so callers treat
// `window.desktop` as optional.

const { contextBridge, ipcRenderer, webUtils } = require('electron')

/** @type {Set<(action: string) => void>} */
const mediaKeyListeners = new Set()

ipcRenderer.on('media-key', (_event, action) => {
  for (const fn of mediaKeyListeners) {
    try {
      fn(action)
    } catch (err) {
      console.error('[desktop] media key listener failed', err)
    }
  }
})

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },

  /** Hardware media keys, forwarded from the main process. */
  onMediaKey(fn) {
    mediaKeyListeners.add(fn)
    return () => mediaKeyListeners.delete(fn)
  },

  /** Menu-driven actions the renderer owns (equalizer panel, directory…). */
  onMenuCommand(fn) {
    const handler = (_e, command) => fn(command)
    ipcRenderer.on('menu-command', handler)
    return () => ipcRenderer.removeListener('menu-command', handler)
  },

  /** Tell the main process what is playing, for the window title. */
  setNowPlaying(text) {
    ipcRenderer.send('now-playing', text)
  },

  /** Which of these `file://` URLs name a file on this machine. */
  filesExist(urls) {
    return ipcRenderer.invoke('files-exist', urls)
  },

  /** Native folder picker; resolves to a `file://` URL ending in `/`, or null. */
  pickFolder(title) {
    return ipcRenderer.invoke('pick-folder', title)
  },

  /** Native folder picker for the local library; resolves to a path, or null. */
  pickDirectory(title) {
    return ipcRenderer.invoke('pick-directory', title)
  },

  /** Whole-track loudness of a `file://` URL in LUFS, or null. */
  measureLoudness(fileUrl) {
    return ipcRenderer.invoke('measure-loudness', fileUrl)
  },

  /** One level of a directory: subfolders and audio files. */
  listDir(dirPath) {
    return ipcRenderer.invoke('list-dir', dirPath)
  },

  /** Display tags for a batch of files, in the same order. */
  readTags(paths) {
    return ipcRenderer.invoke('read-tags', paths)
  },

  /** Rewrite some of an MP3's tags; undefined fields stay, empty strings remove. */
  writeTags(filePath, fields) {
    return ipcRenderer.invoke('write-tags', filePath, fields)
  },

  /** Text tags of every MP3 in a folder (and below, unless `recursive` is false). */
  async scanTags(dirPath, onProgress, recursive = true) {
    const handler = (_e, progress) => onProgress?.(progress)
    ipcRenderer.on('tag-scan-progress', handler)
    try {
      return await ipcRenderer.invoke('scan-tags', dirPath, recursive)
    } finally {
      ipcRenderer.removeListener('tag-scan-progress', handler)
    }
  },

  /** Native multi-file picker for the local library; resolves to paths. */
  pickAudioPaths() {
    return ipcRenderer.invoke('pick-audio-paths')
  },

  /** Listing-style entries for single files, with their folder's cover. */
  fileEntries(filePaths, keepMissing = false) {
    return ipcRenderer.invoke('file-entries', filePaths, keepMissing)
  },

  /** Audio files among dropped paths, folders walked, at most `limit` of them. */
  collectAudio(paths, limit, skip = []) {
    return ipcRenderer.invoke('collect-audio', paths, limit, skip)
  },

  /** Show a context menu; resolves to the chosen item's id, or null. */
  showContextMenu(items, position) {
    return ipcRenderer.invoke('context-menu', items, position)
  },

  /** Select a file or folder in Finder / the file manager. */
  revealFile(filePath) {
    return ipcRenderer.invoke('reveal-file', filePath)
  },

  /** Where a file dropped from the OS lives; `File.path` is gone in Electron 32+. */
  pathForFile(file) {
    return webUtils.getPathForFile(file)
  },

  /** The local library's play queue, as paths in play order. */
  queue: {
    list() {
      return ipcRenderer.invoke('queue:list')
    },
    set(paths) {
      return ipcRenderer.invoke('queue:set', paths)
    },
  },

  /** Single files in the local library, beside the root folders. */
  looseFiles: {
    list() {
      return ipcRenderer.invoke('loose-files:list')
    },
    add(filePaths) {
      return ipcRenderer.invoke('loose-files:add', filePaths)
    },
    remove(filePath) {
      return ipcRenderer.invoke('loose-files:remove', filePath)
    },
  },

  /** The local library's root folders, kept in SQLite. */
  folders: {
    list() {
      return ipcRenderer.invoke('folders:list')
    },
    add(folderPath) {
      return ipcRenderer.invoke('folders:add', folderPath)
    },
    remove(folderPath) {
      return ipcRenderer.invoke('folders:remove', folderPath)
    },
  },

  /** The station library, kept in SQLite by the main process. */
  library: {
    load() {
      return ipcRenderer.invoke('library:load')
    },
    write(ops) {
      return ipcRenderer.invoke('library:write', ops)
    },
  },
})

// Let CSS target the desktop shell without React having to know about it —
// notably the inset traffic lights on macOS.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.desktop = process.platform
})
