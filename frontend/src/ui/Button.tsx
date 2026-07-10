import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

export function Button({ children, ...rest }: ButtonProps) {
  return (
    <button className="vg-button" {...rest}>
      {children}
    </button>
  )
}
