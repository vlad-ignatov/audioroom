// Preload: the only bridge between the renderer and the main process.
//
// Context isolation stays on, so the renderer gets a small frozen surface
// rather than any part of Node. Everything here is additive — the app must
// still run in a plain browser during development, so callers treat
// `window.desktop` as optional.

const { contextBridge, ipcRenderer } = require('electron')

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
})

// Let CSS target the desktop shell without React having to know about it —
// notably the inset traffic lights on macOS.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.desktop = process.platform
})
