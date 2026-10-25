import { useLocalLibrary } from '@/store/localLibrary'
import { run } from '@/commands'
import { desktop } from '@/lib/desktop'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'

export function LocalToolbar() {
  const hasRoots = useLocalLibrary((s) => s.roots.length > 0)
  if (!desktop) return null

  return (
    <div className="flex py-1 shrink-0 items-center gap-2 px-2 bg-bg-raised">
      <Button size="sm" onClick={() => run('library.addFolder')}>
        <Icon name="folderPlus" size={16} />
        Add folder
      </Button>
      <Button size="sm" onClick={() => run('library.addFiles')}>
        <Icon name="filePlus" size={16} />
        Add files
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          disabled={!hasRoots}
          onClick={() => run('library.refresh')}
          title="Read the open folders from disk again"
        >
          <Icon name="refresh" size={16} />
          Refresh
        </Button>
      </div>
    </div>
  )
}
