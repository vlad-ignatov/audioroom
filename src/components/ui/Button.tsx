import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'ghost' | 'solid' | 'accent' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  ghost: 'bg-transparent text-ink-dim hover:bg-panel-hi hover:text-ink',
  solid: 'bg-panel text-ink border border-line hover:bg-panel-hi',
  accent: 'bg-accent text-bg font-medium hover:bg-accent/90',
  danger: 'bg-transparent text-bad hover:bg-bad/15',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-2 rounded-md',
  lg: 'h-10 px-4 text-sm gap-2 rounded-lg',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children?: ReactNode
}

export function Button({ variant = 'ghost', size = 'md', className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap transition-colors select-none',
        'disabled:opacity-40 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  )
}

interface IconButtonProps extends Props {
  label: string
}

export function IconButton({ label, className, ...rest }: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      title={label}
      className={cn('!px-0 aspect-square', className)}
      {...rest}
    />
  )
}
