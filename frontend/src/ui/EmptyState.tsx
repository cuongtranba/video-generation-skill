import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

interface EmptyStateProps extends HTMLAttributes<HTMLParagraphElement> {
  /** Optional lead-in glyph or emoji. */
  icon?: ReactNode
  children: ReactNode
}

/** Muted placeholder shown when a list or region has nothing to display yet. */
export function EmptyState({ icon, className, children, ...rest }: EmptyStateProps) {
  return (
    <p className={cx('vg-empty', className)} {...rest}>
      {icon != null && <span className="vg-empty__icon">{icon}</span>}
      {children}
    </p>
  )
}
