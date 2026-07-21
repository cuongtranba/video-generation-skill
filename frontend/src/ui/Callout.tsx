import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

interface CalloutProps extends HTMLAttributes<HTMLParagraphElement> {
  tone?: 'info' | 'good' | 'warn' | 'error'
  children: ReactNode
}

/** Inline message strip for status, locks, and errors. Tone sets the accent. */
export function Callout({ tone = 'info', className, children, ...rest }: CalloutProps) {
  return (
    <p className={cx('vg-callout', `vg-callout--${tone}`, className)} {...rest}>
      {children}
    </p>
  )
}
