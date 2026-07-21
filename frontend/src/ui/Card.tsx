import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Heading rendered in the card header. */
  title?: ReactNode
  /** Secondary text beside the title (status, timestamp, …). */
  meta?: ReactNode
  /** Trailing header slot for badges or actions. */
  actions?: ReactNode
}

/** Surface container. Renders an optional header row when any of title/meta/actions is set. */
export function Card({ title, meta, actions, className, children, ...rest }: CardProps) {
  const hasHeader = title != null || meta != null || actions != null
  return (
    <article className={cx('vg-card', className)} {...rest}>
      {hasHeader && (
        <header className="vg-card__header">
          {title != null && <h2 className="vg-card__title">{title}</h2>}
          {meta != null && <span className="vg-card__meta">{meta}</span>}
          {actions != null && <div className="vg-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </article>
  )
}
