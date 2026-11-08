// Client-safe: no imports at all, so 'use client' forms can bundle it. Do not import @blueyvatar/core or node: modules here.

/**
 * What a form action returns instead of redirecting, so the form keeps what was typed.
 * `values` is set after any failed submit. `errors` are per field. `formError` is a problem
 * that belongs to no single field (rate limit, write error, expired session).
 */
export type FormState<V, F extends string = string> = {
  values?: V
  errors?: Partial<Record<F, string>>
  formError?: string
  sessionExpired?: boolean
  /** Success message, for forms that stay on the page after saving. */
  done?: string
}

export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Sign in again; what you typed stays on this page.'

/** The first field that has an error, in the order the fields appear on the page. */
export function firstInvalid<F extends string>(errors: Partial<Record<F, string>> | undefined, order: readonly F[]): F | undefined {
  return order.find((f) => errors?.[f])
}
