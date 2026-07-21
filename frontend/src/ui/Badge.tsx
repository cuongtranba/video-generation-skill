import type { ReactNode } from 'react'
import { cx } from './cx'

interface BadgeProps {
  tone?: 'neutral' | 'good' | 'bad'
  className?: string
  children: ReactNode
}

export function Badge({ tone = 'neutral', className, children }: BadgeProps) {
  return <span className={cx('vg-badge', `vg-badge--${tone}`, className)}>{children}</span>
}
