/**
 * Typed access to the Electron preload bridge.
 *
 * The app is a desktop app, but it still runs in a plain browser during
 * development, so every caller must tolerate `desktop` being absent.
 */

export type MediaKeyAction = 'toggle' | 'next' | 'previous' | 'stop'

export type MenuCommand =
  | 'toggle'
  | 'next'
  | 'previous'
  | 'volume-up'
  | 'volume-down'
  | 'mute'
  | 'stop'
  | 'toggle-equalizer'
  | 'open-directory'
  | 'add-station'

export interface DesktopBridge {
  isDesktop: true
  platform: NodeJS.Platform
  versions: { electron: string; chrome: string }
  onMediaKey(fn: (action: MediaKeyAction) => void): () => void
  onMenuCommand(fn: (command: MenuCommand) => void): () => void
  setNowPlaying(text: string): void
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}

export const desktop: DesktopBridge | undefined =
  typeof window === 'undefined' ? undefined : window.desktop

/**
 * True when running inside the Electron shell.
 *
 * Used to skip the browser workarounds — the CORS probe, the https upgrade —
 * that the main process has already made unnecessary.
 */
export const isDesktop = desktop?.isDesktop === true
