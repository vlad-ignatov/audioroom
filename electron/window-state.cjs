// Remember window geometry between runs.
//
// Deliberately tiny and dependency-free: a JSON file in userData, written on a
// debounce, and validated on read because a saved position can become invalid
// when a display is disconnected.

const { app, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const FILE = () => path.join(app.getPath('userData'), 'window-state.json')
const DEFAULTS = { width: 1180, height: 800 }

function read() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    if (typeof saved.width !== 'number' || typeof saved.height !== 'number') return DEFAULTS
    // A window restored onto a display that no longer exists is unreachable.
    if (typeof saved.x === 'number' && typeof saved.y === 'number') {
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea
        return saved.x < b.x + b.width && saved.x + 200 > b.x && saved.y < b.y + b.height && saved.y + 60 > b.y
      })
      if (!visible) return { width: saved.width, height: saved.height }
    }
    return saved
  } catch {
    return DEFAULTS
  }
}

function track(win) {
  let timer = null
  const save = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
      const { x, y, width, height } = win.getNormalBounds()
      try {
        fs.writeFileSync(FILE(), JSON.stringify({ x, y, width, height }))
      } catch {
        // Not worth surfacing; geometry is a convenience.
      }
    }, 400)
  }
  win.on('resize', save)
  win.on('move', save)
  win.on('close', save)
}

module.exports = { read, track, DEFAULTS }
