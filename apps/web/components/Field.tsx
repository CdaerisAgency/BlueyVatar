import type { ReactNode } from 'react'
import { FieldError } from './FormNotices'

/**
 * One form field: label, optional hint, the input, and an error message. Required fields show a star after the label.
 * Give the input `fieldProps(prefix, name, error, hint ? `${prefix}-${name}-hint` : undefined)` so the error and hint are read with it.
 */
export function Field({ prefix, name, label, hint, error, required = false, children }: {
  prefix: string
  name: string
  label: ReactNode
  hint?: ReactNode
  error?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label>
      <span>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {hint && <span id={`${prefix}-${name}-hint`} className="bv-hint">{hint}</span>}
      {children}
      <FieldError prefix={prefix} name={name} error={error} />
    </label>
  )
}
