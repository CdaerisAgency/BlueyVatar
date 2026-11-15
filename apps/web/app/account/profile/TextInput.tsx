'use client'
import type { InputHTMLAttributes } from 'react'
import { countGraphemes } from '../../../lib/profile-limits'

export function Counter({ value, max }: { value: string; max: number }) {
  const n = countGraphemes(value)
  return <span className={n > max ? 'field-error' : undefined}>{n} of {max} characters</span>
}

/** A label wrapping one text input, with its error message and an optional live character count (`countMax`). The input gets `id`, aria-invalid, and aria-describedby for the error and the count. */
export function TextInput({ id, label, error, countMax, value, ...input }: {
  id: string
  label: string
  error: string | undefined
  /** Shows "n of max characters" under the input and links it to the input. */
  countMax?: number
  value: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'aria-invalid' | 'aria-describedby'>) {
  const describedBy = [error && `${id}-error`, countMax !== undefined && `${id}-count`].filter(Boolean).join(' ') || undefined
  return (
    <label>
      {label}
      <input id={id} value={value} {...input} aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
      {countMax !== undefined && <span id={`${id}-count`} aria-live="polite"><Counter value={value} max={countMax} /></span>}
      {error && <span id={`${id}-error`} className="field-error">{error}</span>}
    </label>
  )
}
