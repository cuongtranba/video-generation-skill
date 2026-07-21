import type { HTMLAttributes } from 'react'
import { cx } from './cx'

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** Vertical gap between children. */
  gap?: 'xs' | 'sm' | 'md' | 'lg'
}

/** Vertical layout helper: stacks children with a token-driven gap. */
export function Stack({ gap = 'md', className, children, ...rest }: StackProps) {
  return (
    <div className={cx('vg-stack', `vg-stack--${gap}`, className)} {...rest}>
      {children}
    </div>
  )
}
