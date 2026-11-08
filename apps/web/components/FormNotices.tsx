'use client'
import { useEffect, type RefObject } from 'react'
import { firstInvalid, type FormState } from '../lib/form-state'

/** Error summary, form-level error, and success message. Same markup as the profile form. */
export function FormNotices<F extends string>({ prefix, labels, state, summary }: {
  prefix: string
  /** Field names in page order. */
  labels: readonly F[]
  state: FormState<unknown, F>
  summary: RefObject<HTMLDivElement | null>
}) {
  const problems = labels.filter((f) => state.errors?.[f]).map((f) => [f, state.errors![f]!] as const)
  return (
    <div ref={summary} tabIndex={-1}>
      {problems.length > 0 && (
        <div role="alert">
          <p>Fix these and try again. Everything you typed is still here.</p>
          <ul>
            {problems.map(([f, m]) => (
              <li key={f}><a href={`#${prefix}-${f}`}>{m}</a></li>
            ))}
          </ul>
        </div>
      )}
      {state.formError && (
        <p role="alert">
          {state.formError}
          {state.sessionExpired && <> <a href="/login" target="_blank" rel="noreferrer">Sign in again</a> in a new tab, then submit here.</>}
        </p>
      )}
      {state.done && <p role="status">{state.done}</p>}
    </div>
  )
}

/** After a result comes back, move focus to the first invalid field, or to the notices when no field is at fault. */
export function useFocusResult<F extends string>(state: FormState<unknown, F>, prefix: string, order: readonly F[], summary: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    if (!state.errors && !state.formError && !state.done) return
    const first = firstInvalid(state.errors, order)
    if (first) document.getElementById(`${prefix}-${first}`)?.focus()
    else summary.current?.focus()
  }, [state, prefix, order, summary])
}

/** Props that mark a field invalid and point to its message. */
export function fieldProps(prefix: string, name: string, error: string | undefined, extra?: string) {
  return {
    id: `${prefix}-${name}`,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': [error && `${prefix}-${name}-error`, extra].filter(Boolean).join(' ') || undefined,
  }
}

export function FieldError({ prefix, name, error }: { prefix: string; name: string; error: string | undefined }) {
  return error ? <span id={`${prefix}-${name}-error`} className="field-error">{error}</span> : null
}
