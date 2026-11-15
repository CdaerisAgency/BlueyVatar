'use client'
import { useEffect, type RefObject } from 'react'
import { firstInvalid, type FormState } from '../lib/form-state'
import { fieldProps } from '../lib/field-props'

// Re-exported so existing client forms keep their import. Server pages import it from lib/field-props.
export { fieldProps }

/** Error summary, form-level error, and success message. Same markup as the profile form. */
export function FormNotices<F extends string>({ prefix, labels, state, summary, retry = { again: 'try again', submit: 'submit' }, idFor = (f) => `${prefix}-${f}` }: {
  prefix: string
  /** Field names in page order. */
  labels: readonly F[]
  state: FormState<unknown, F>
  summary: RefObject<HTMLDivElement | null>
  /** The words for the next step: "Fix these and ${again}", "then ${submit} here". */
  retry?: { again: string; submit: string }
  /** The element id of a field, when it is not `${prefix}-${field}`. */
  idFor?: (field: F) => string
}) {
  const problems = labels.filter((f) => state.errors?.[f]).map((f) => [f, state.errors![f]!] as const)
  return (
    <div ref={summary} tabIndex={-1}>
      {problems.length > 0 && (
        <div role="alert">
          <p>Fix these and {retry.again}. Everything you typed is still here.</p>
          <ul>
            {problems.map(([f, m]) => (
              <li key={f}><a href={`#${idFor(f)}`}>{m}</a></li>
            ))}
          </ul>
        </div>
      )}
      {state.formError && (
        <p role="alert">
          {state.formError}
          {state.sessionExpired && <> <a href="/login" target="_blank" rel="noreferrer">Sign in again</a> in a new tab, then {retry.submit} here.</>}
        </p>
      )}
      {state.done && <p role="status">{state.done}</p>}
    </div>
  )
}

/** After a result comes back, move focus to the first invalid field, or to the notices when no field is at fault. */
export function useFocusResult<F extends string>(state: FormState<unknown, F>, prefix: string, order: readonly F[], summary: RefObject<HTMLDivElement | null>, idFor?: (field: F) => string): void {
  useEffect(() => {
    if (!state.errors && !state.formError && !state.done) return
    const first = firstInvalid(state.errors, order)
    if (first) document.getElementById(idFor ? idFor(first) : `${prefix}-${first}`)?.focus()
    else summary.current?.focus()
  }, [state, prefix, order, summary, idFor])
}

export function FieldError({ prefix, name, error }: { prefix: string; name: string; error: string | undefined }) {
  return error ? <span id={`${prefix}-${name}-error`} className="field-error">{error}</span> : null
}
