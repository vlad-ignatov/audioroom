import type { ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { Icon } from './Icon'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: Props) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2',
            'flex-col overflow-hidden rounded-xl border border-line bg-bg-raised shadow-2xl',
            className,
          )}
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-line-soft px-4 py-3">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-sm font-medium text-ink">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-0.5 text-xs leading-relaxed text-ink-faint">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="rounded p-1 text-ink-faint hover:bg-panel hover:text-ink"
            >
              <Icon name="x" size={16} />
            </RadixDialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>

          {footer && (
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line-soft px-4 py-3">
              {footer}
            </footer>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
