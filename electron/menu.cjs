// Application menu.
//
// Without one, Electron gives a macOS app no Cmd+Q, no Cmd+C in text fields
// and no window management, so this is load-bearing rather than decoration.
// Items send command ids from the renderer's registry (src/commands).

const { app, Menu, shell } = require('electron')

/** @param {(command: string) => void} send */
function buildMenu(send) {
  const isMac = process.platform === 'darwin'

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Station…',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('station.add'),
        },
        {
          label: 'Add Files…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('library.addFiles'),
        },
        {
          label: 'Add Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send('library.addFolder'),
        },
        {
          label: 'Browse Stations…',
          accelerator: 'CmdOrCtrl+F',
          click: () => send('stations.browse'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'selectAll' }] : [{ role: 'delete' }, { role: 'selectAll' }]),
      ],
    },
    {
      label: 'Playback',
      submenu: [
        {
          label: 'Play / Pause',
          // No accelerator on macOS.
          //
          // An unmodified key equivalent is dispatched by AppKit ahead of the
          // focused view, so a registered Space fires while the listener is
          // typing a filter or a preset name — and the renderer never receives
          // the key, so no amount of focus checking there can prevent it.
          // `registerAccelerator: false` would display the shortcut without
          // registering it, but that option is Linux and Windows only. The
          // renderer binds Space itself and knows what is focused, so here the
          // item is click-only on macOS and merely advertised elsewhere.
          ...(isMac ? {} : { accelerator: 'Space', registerAccelerator: false }),
          click: () => send('playback.toggle'),
        },
        { label: 'Next Station', accelerator: 'CmdOrCtrl+Right', click: () => send('playback.next') },
        { label: 'Previous Station', accelerator: 'CmdOrCtrl+Left', click: () => send('playback.previous') },
        { type: 'separator' },
        { label: 'Volume Up', accelerator: 'CmdOrCtrl+Up', click: () => send('volume.up') },
        { label: 'Volume Down', accelerator: 'CmdOrCtrl+Down', click: () => send('volume.down') },
        { label: 'Mute', accelerator: 'CmdOrCtrl+M', click: () => send('volume.mute') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Internet Radio', accelerator: 'CmdOrCtrl+1', click: () => send('view.radio') },
        { label: 'Local Library', accelerator: 'CmdOrCtrl+2', click: () => send('view.local') },
        { type: 'separator' },
        { label: 'Equalizer', accelerator: 'CmdOrCtrl+E', click: () => send('eq.toggle') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      role: 'window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => send('shortcuts.show'),
        },
        { type: 'separator' },
        {
          label: 'radio-browser.info',
          click: () => void shell.openExternal('https://www.radio-browser.info/'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

module.exports = { buildMenu }
