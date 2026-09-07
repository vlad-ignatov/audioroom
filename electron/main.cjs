// Electron main process.
//
// The renderer is the existing Vite app. The jobs here are to remove the
// browser restrictions the web build had to negotiate — this is a desktop app
// talking to public radio servers, so the same-origin policy buys nothing and
// costs a large share of the directory — and to provide the native shell:
// menu, media keys, window state, external links.

const { app, BrowserWindow, session, shell, ipcMain, globalShortcut } = require('electron')
const path = require('node:path')
const windowState = require('./window-state.cjs')
const { buildMenu } = require('./menu.cjs')

const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
const isDev = !app.isPackaged

/** @type {BrowserWindow | null} */
let mainWindow = null

/**
 * Make every response look CORS-clean to the renderer.
 *
 * Icecast and Shoutcast servers overwhelmingly predate anyone streaming into
 * Web Audio and send no `Access-Control-Allow-Origin`. In a browser that is
 * final; here we own the network stack, so we add the header ourselves rather
 * than turning `webSecurity` off wholesale — the same-origin policy still
 * applies to everything else the window loads.
 */
function installCorsBypass(sess) {
  // Some servers reject requests carrying a browser Origin, and it serves no
  // purpose once we are answering the CORS question ourselves.
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders }
    delete requestHeaders.Origin
    delete requestHeaders.origin
    callback({ requestHeaders })
  })

  sess.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders }
    // Strip existing values first: Chromium rejects a duplicated ACAO outright,
    // and plenty of these servers already send one.
    for (const key of Object.keys(responseHeaders)) {
      if (key.toLowerCase().startsWith('access-control-')) delete responseHeaders[key]
    }
    responseHeaders['Access-Control-Allow-Origin'] = ['*']
    responseHeaders['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS']
    responseHeaders['Access-Control-Allow-Headers'] = ['*']
    responseHeaders['Access-Control-Expose-Headers'] = ['*']

    // A ranged probe is a non-simple request, so Chromium preflights it. Most
    // stream servers answer OPTIONS with 400/405, which fails the preflight and
    // makes a perfectly good station look unreachable. Force those to 200; the
    // real GET that follows is unaffected.
    const failedPreflight =
      details.method === 'OPTIONS' && (details.statusCode < 200 || details.statusCode > 299)

    callback(
      failedPreflight
        ? { responseHeaders, statusLine: 'HTTP/1.1 200 OK' }
        : { responseHeaders },
    )
  })
}

function send(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu-command', command)
  }
}

function sendMediaKey(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('media-key', action)
  }
}

function createWindow() {
  const state = windowState.read()

  const win = new BrowserWindow({
    ...state,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0b0b0c',
    // Inset traffic lights on macOS; the renderer pads its header to match.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Don't flash an empty frame while the bundle boots.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Left on: the CORS headers above are enough, and this keeps the normal
      // protections for everything the window loads.
      webSecurity: true,
      // Radio playback should keep running when the window is in the background.
      backgroundThrottling: false,
    },
  })

  mainWindow = win
  windowState.track(win)

  win.once('ready-to-show', () => win.show())

  // Station homepages belong in the user's browser, not in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Nothing should be able to navigate the app window away from the app.
  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    const here = new URL(isDev ? DEV_URL : 'file://')
    if (target.origin !== here.origin) {
      event.preventDefault()
      if (/^https?:$/.test(target.protocol)) void shell.openExternal(url)
    }
  })

  if (isDev) {
    // The dev server may not be up yet; retry rather than showing an error page.
    const load = () => {
      win.loadURL(DEV_URL).catch(() => setTimeout(load, 400))
    }
    load()
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })

  return win
}

// A second launch should focus the existing window, not start a rival player.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    installCorsBypass(session.defaultSession)
    buildMenu(send)
    createWindow()

    // Hardware media keys. Registration fails harmlessly if another app owns
    // them, so a failure is not worth reporting to the user.
    const keys = {
      MediaPlayPause: 'toggle',
      MediaNextTrack: 'next',
      MediaPreviousTrack: 'previous',
      MediaStop: 'stop',
    }
    for (const [accelerator, action] of Object.entries(keys)) {
      try {
        globalShortcut.register(accelerator, () => sendMediaKey(action))
      } catch {
        // Ignore; the in-app shortcuts still work.
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// The renderer reports what is playing so the window title can follow it.
ipcMain.on('now-playing', (_event, text) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setTitle(text ? `${text} — Player` : 'Player')
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
