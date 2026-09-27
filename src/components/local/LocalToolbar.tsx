import { useLocalLibrary } from '@/store/localLibrary'
import { desktop } from '@/lib/desktop'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'

export function LocalToolbar({ onNotify }: { onNotify: (message: string) => void }) {
  const { addFolder, addFiles, refresh } = useLocalLibrary.getState()
  const hasRoots = useLocalLibrary((s) => s.roots.length > 0)
  if (!desktop) return null

  return (
    <div className="flex pt-1 shrink-0 items-center gap-2 px-2 bg-bg-raised">
      <Button size="sm" onClick={() => void addFolder().then((message) => message && onNotify(message))}>
        <Icon name="folderPlus" size={16} />
        Add folder
      </Button>
      <Button size="sm" onClick={() => void addFiles().then((message) => message && onNotify(message))}>
        <Icon name="filePlus" size={16} />
        Add files
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          disabled={!hasRoots}
          onClick={() => void refresh()}
          title="Read the open folders from disk again"
        >
          <Icon name="refresh" size={16} />
          Refresh
        </Button>
      </div>
    </div>
  )
}
