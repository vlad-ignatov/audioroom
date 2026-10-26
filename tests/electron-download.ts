import { createRequire } from 'node:module'

// The main-process modules require('electron'), which outside Electron
// returns the path to its binary and downloads the binary first if it is
// missing. Do that once here: test files load in parallel, and parallel
// downloads into the same folder collide.
export default function setup() {
  createRequire(import.meta.url)('electron')
}
