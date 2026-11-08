import type { FormState } from './form-state'
import { HANDLE_ERROR, normalizeHandle } from '../app/login/handle'

export type LoginValues = { handle: string; next: string }
export type LoginState = FormState<LoginValues, 'handle'>

export type LoginDeps = {
  /** Lockout or rate limit message, or null. */
  blocked: () => Promise<string | null>
  parse: (handle: string) => { kind: string; value: string } | null
  failed: () => Promise<void>
  remember: () => Promise<void>
  /** Starts sign-in. Returns the URL to send the browser to. */
  start: (id: string) => Promise<{ ok: true; url: string } | { ok: false }>
}

/** Validates, then starts sign-in. A failure returns the typed handle so the box keeps it. A success returns `redirectTo`. */
export async function runLogin(form: FormData, next: string, deps: LoginDeps): Promise<LoginState & { redirectTo?: string }> {
  const values: LoginValues = { handle: String(form.get('handle') ?? ''), next }
  const handle = normalizeHandle(values.handle)
  if (!handle) return { values, errors: { handle: HANDLE_ERROR } }
  const wait = await deps.blocked()
  if (wait) return { values, formError: wait }
  const id = deps.parse(handle)
  if (!id || id.kind === 'hash') {
    await deps.failed()
    return { values, errors: { handle: 'Enter a valid handle such as alice.bsky.social.' } }
  }
  await deps.remember()
  const r = await deps.start(id.value)
  if (!r.ok) {
    await deps.failed()
    return { values, formError: 'Could not start sign-in. Check the handle and try again.' }
  }
  return { redirectTo: r.url }
}

