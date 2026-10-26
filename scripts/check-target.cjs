// Fail early, and say why, when this machine cannot build a package.
//
//   node scripts/check-target.cjs mac|win|linux
//
// Run by the package:* scripts before the build. Without it, electron-builder
// gets through type-checking, bundling and packaging before failing on a tool
// it cannot run, often with nothing more than "spawn Unknown system error -86".

const { execFileSync } = require('node:child_process')

const NAMES = { mac: 'macOS', win: 'Windows', linux: 'Linux' }
const host = process.platform
const target = process.argv[2]

function fail(message) {
  console.error(`\nCannot build the ${NAMES[target]} package on this machine.\n\n${message}\n`)
  process.exit(1)
}

/**
 * Whether Intel binaries run here. electron-builder's tools for the Windows
 * installer (makensis) and the AppImage are Intel-only on macOS, so an Apple
 * Silicon Mac runs them through Rosetta 2.
 */
function hasRosetta() {
  try {
    execFileSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function needRosetta(tool) {
  if (host === 'darwin' && process.arch === 'arm64' && !hasRosetta()) {
    fail(
      `The ${tool} electron-builder uses on macOS is an Intel program, and this\n` +
        `Apple Silicon Mac does not have Rosetta 2 to run it. Install it once with:\n\n` +
        `  softwareupdate --install-rosetta --agree-to-license`,
    )
  }
}

if (!NAMES[target]) {
  console.error(`Usage: node scripts/check-target.cjs ${Object.keys(NAMES).join('|')}`)
  process.exit(2)
}

if (target === 'mac' && host !== 'darwin') {
  fail('macOS packages can only be built on a Mac: the .dmg is made with macOS\'s own disk image tools.')
}
if (target === 'win') needRosetta('installer builder (makensis)')
if (target === 'linux') {
  if (host === 'win32') fail('electron-builder cannot build Linux packages on Windows. Build on Linux or macOS.')
  needRosetta('AppImage builder')
}
