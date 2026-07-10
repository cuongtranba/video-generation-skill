import type { ReactNode } from 'react'

interface BadgeProps {
  tone?: 'neutral' | 'good' | 'bad'
  children: ReactNode
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return <span className={`vg-badge vg-badge--${tone}`}>{children}</span>
}
