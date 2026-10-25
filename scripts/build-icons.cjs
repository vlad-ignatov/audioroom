// Render build/icon.svg into every icon file the packaged app needs:
//
//   build/icon.icns       macOS (packed from build/icon.iconset by iconutil)
//   build/icon.png        Windows (electron-builder makes the .ico from it)
//   build/icons/NxN.png   Linux, and the window icon on Linux
//
// Run with `npm run icons` after changing the SVG. Chromium does the drawing,
// so there is nothing to install; each size is drawn from the vector rather
// than scaled down from a large bitmap, which keeps the small ones crisp.
// The .icns needs macOS; elsewhere the PNGs are still written.

const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const BUILD = path.join(__dirname, '..', 'build')
const SIZES = [16, 32, 64, 128, 256, 512, 1024]
/** iconutil's file names: each size, and each at twice the pixels. */
const ICONSET = [16, 32, 128, 256, 512]

// A tool, not the app: no Dock icon, no window.
app.dock?.hide()

async function render(svg) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  try {
    await win.loadURL('data:text/html,<!doctype html><title>icons</title>')
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    const encoded = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image()
      img.src = ${JSON.stringify(src)}
      await img.decode()
      const out = {}
      for (const n of ${JSON.stringify(SIZES)}) {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = n
        canvas.getContext('2d').drawImage(img, 0, 0, n, n)
        out[n] = canvas.toDataURL('image/png').split(',')[1]
      }
      return out
    })()`)
    return Object.fromEntries(Object.entries(encoded).map(([n, b64]) => [n, Buffer.from(b64, 'base64')]))
  } finally {
    win.destroy()
  }
}

async function main() {
  const png = await render(fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8'))
  const write = (file, size) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, png[size])
    console.log(path.relative(process.cwd(), file))
  }

  write(path.join(BUILD, 'icon.png'), 1024)
  for (const n of SIZES.filter((n) => n <= 512)) write(path.join(BUILD, 'icons', `${n}x${n}.png`), n)

  const iconset = path.join(BUILD, 'icon.iconset')
  for (const n of ICONSET) {
    write(path.join(iconset, `icon_${n}x${n}.png`), n)
    write(path.join(iconset, `icon_${n}x${n}@2x.png`), n * 2)
  }
  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD, 'icon.icns')])
    console.log(path.relative(process.cwd(), path.join(BUILD, 'icon.icns')))
  } else {
    console.log('Not on macOS: build/icon.icns left as it was.')
  }
}

app
  .whenReady()
  .then(main)
  .then(
    () => app.quit(),
    (err) => {
      console.error(err)
      app.exit(1)
    },
  )
