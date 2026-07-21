import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: ButtonVariant
}

export function Button({ children, variant = 'primary', ...rest }: ButtonProps) {
  return (
    <button className={`vg-button vg-button--${variant}`} {...rest}>
      {children}
    </button>
  )
}
