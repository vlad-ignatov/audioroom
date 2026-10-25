import { create } from 'zustand'
import type { Station } from '@/types/station'
import type { DirFile } from '@/lib/desktop'

/**
 * Which view and dialogs are showing, and the toast.
 *
 * Kept in a store rather than in App's state so that commands — run from a
 * context menu, a shortcut or the menu bar — can open them without being
 * handed callbacks by whichever component happens to own them.
 */

export type View = 'radio' | 'local'

const VIEW_KEY = 'app.view'

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'local' ? 'local' : 'radio'
  } catch {
    return 'radio'
  }
}

interface UiState {
  view: View
  directoryOpen: boolean
  shortcutsOpen: boolean
  /** The station editor: open on a station, or on a new one when `station` is null. */
  stationEditor: { open: boolean; station: Station | null }
  /** The file whose tags are being edited. */
  tagEditor: DirFile | null
  /** A folder being searched for mis-encoded tags. */
  encodingFix: string | null
  /** A folder whose files are getting a common artist or album. */
  folderTags: string | null
  toast: string | null

  setView: (view: View) => void
  setDirectoryOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  editStation: (station: Station | null) => void
  closeStationEditor: () => void
  setTagEditor: (file: DirFile | null) => void
  setEncodingFix: (folder: string | null) => void
  setFolderTags: (folder: string | null) => void
  /** Show a short message; it clears itself. */
  notify: (message: string) => void
}

let toastTimer: number | null = null

export const useUi = create<UiState>()((set) => ({
  view: loadView(),
  directoryOpen: false,
  shortcutsOpen: false,
  stationEditor: { open: false, station: null },
  tagEditor: null,
  encodingFix: null,
  folderTags: null,
  toast: null,

  setView: (view) => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      // The last tab is a convenience.
    }
    set({ view })
  },
  setDirectoryOpen: (directoryOpen) => set({ directoryOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  // The station stays while the dialog animates closed.
  editStation: (station) => set({ stationEditor: { open: true, station } }),
  closeStationEditor: () => set((st) => ({ stationEditor: { ...st.stationEditor, open: false } })),
  setTagEditor: (tagEditor) => set({ tagEditor }),
  setEncodingFix: (encodingFix) => set({ encodingFix }),
  setFolderTags: (folderTags) => set({ folderTags }),
  notify: (toast) => {
    if (toastTimer !== null) clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => set({ toast: null }), 3200)
    set({ toast })
  },
}))
