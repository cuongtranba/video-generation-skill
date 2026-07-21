import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx('vg-button', `vg-button--${variant}`, `vg-button--${size}`, className)}
      {...rest}
    >
      {children}
    </button>
  )
}
