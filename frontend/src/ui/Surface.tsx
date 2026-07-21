import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

/**
 * Theme root. Establishes the design system's dark canvas — background, text
 * color, and base font. Wrap an app (or any DS composition) in it so tokens
 * and element defaults apply. This is the design system's top-level wrapper.
 */
export function Surface({ className, children, ...rest }: SurfaceProps) {
  return (
    <div className={cx('vg-surface', className)} {...rest}>
      {children}
    </div>
  )
}
