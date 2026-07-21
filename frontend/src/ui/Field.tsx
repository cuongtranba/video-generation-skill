import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  /** Field label text; associate it with a control via `htmlFor`. */
  label: ReactNode
  htmlFor?: string
  /** Span the full width of a multi-column form. */
  wide?: boolean
}

/** Labelled form-field wrapper: a label above one or more controls (children). */
export function Field({ label, htmlFor, wide, className, children, ...rest }: FieldProps) {
  return (
    <div className={cx('vg-field', wide && 'vg-field--wide', className)} {...rest}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  )
}
