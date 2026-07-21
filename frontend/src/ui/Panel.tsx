import type { FieldsetHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

interface PanelProps extends FieldsetHTMLAttributes<HTMLFieldSetElement> {
  /** Panel title rendered in the legend. */
  legend: ReactNode
}

/** Titled fieldset panel. `disabled` natively disables every descendant control. */
export function Panel({ legend, className, children, ...rest }: PanelProps) {
  return (
    <fieldset className={cx('vg-panel', className)} {...rest}>
      <legend className="vg-panel__legend">{legend}</legend>
      {children}
    </fieldset>
  )
}
