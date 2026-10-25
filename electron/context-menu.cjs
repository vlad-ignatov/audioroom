// Context menus, drawn by the OS.
//
// The renderer decides what goes in a menu (see src/commands/dispatch.ts) and
// sends a plain description of it; functions cannot cross IPC. The menu is
// built and shown here, and the index of the chosen item goes back, or null
// if it was dismissed.

const { BrowserWindow, Menu, ipcMain } = require('electron')

/** Edit roles a menu may ask for; they act on whatever has focus. */
const ROLES = new Set(['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo'])

function show(event, items, position) {
  const win = BrowserWindow.fromWebContents(event.sender)
  return new Promise((resolve) => {
    let chosen = null
    const template = items.map((item) => {
      if (item.type === 'separator') return { type: 'separator' }
      if (item.type === 'role') return ROLES.has(item.role) ? { role: item.role } : { type: 'separator' }
      return {
        type: item.type === 'checkbox' ? 'checkbox' : 'normal',
        label: item.label,
        enabled: item.enabled !== false,
        checked: item.checked === true,
        // Shown, not bound: the renderer handles the keys, and knows what is
        // focused (and macOS registers nothing for a popup anyway).
        accelerator: item.accelerator,
        registerAccelerator: false,
        click: () => {
          chosen = item.id
        },
      }
    })
    const menu = Menu.buildFromTemplate(template)
    // `click` may come just after the close callback; give it a turn.
    const options = { callback: () => setTimeout(() => resolve(chosen), 0) }
    if (win) options.window = win
    // Page coordinates, scaled by the page zoom into window coordinates.
    if (position) {
      const zoom = event.sender.getZoomFactor()
      options.x = Math.round(position.x * zoom)
      options.y = Math.round(position.y * zoom)
    }
    menu.popup(options)
  })
}

function install() {
  ipcMain.handle('context-menu', (event, items, position) => show(event, items, position))
}

module.exports = { install }
