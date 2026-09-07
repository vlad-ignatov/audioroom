import * as Tooltip from '@radix-ui/react-tooltip'
import type { Capability } from '@/types/station'

const MEANING: Record<Capability, { label: string; dot: string; text: string; help: string }> = {
  full: {
    label: 'Full',
    dot: 'bg-good',
    text: 'text-good',
    help: 'This server allows Web Audio, so the equalizer and visualizer work.',
  },
  unknown: {
    label: 'Untested',
    dot: 'bg-ink-faint',
    text: 'text-ink-faint',
    help: 'Not played yet. Quality is determined the first time you tune in.',
  },
  'playback-only': {
    label: 'Play only',
    dot: 'bg-warn',
    text: 'text-warn',
    help: 'Plays, but the server forbids Web Audio access, so the equalizer and visualizer are unavailable.',
  },
  unavailable: {
    label: 'Blocked',
    dot: 'bg-bad',
    text: 'text-bad',
    help: 'Cannot be played from this page.',
  },
}

export function CapabilityBadge({
  capability,
  reason,
}: {
  capability: Capability
  reason?: string
}) {
  const m = MEANING[capability]
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className={`inline-flex items-center gap-1.5 text-[11px] ${m.text}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} />
          {m.label}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-50 max-w-64 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-ink-dim shadow-xl"
        >
          {reason ?? m.help}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
