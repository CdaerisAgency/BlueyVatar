import { SESSION_EXPIRED_MESSAGE } from './form-state'
import type { DomainState } from './domain-limits'

export type DomainDeps = {
  limited: (did: string) => Promise<string | null>
  /** False when custom domains are not set up on this server. */
  enabled: boolean
  isPlus: (did: string) => Promise<boolean>
  hasDomain: (did: string) => Promise<boolean>
  validate: (hostname: string) => { ok: true; value: string } | { ok: false; error: string }
  /** Adds the hostname. `field` marks a problem with the typed hostname itself. */
  add: (did: string, hostname: string) => Promise<{ ok: true } | { ok: false; error: string; field?: boolean }>
}

/** Every failure returns the typed hostname. Success returns `done` and the action redirects. */
export async function runAddDomain(did: string | null, form: FormData, deps: DomainDeps): Promise<DomainState> {
  const values = { hostname: String(form.get('hostname') ?? '') }
  if (!did) return { values, sessionExpired: true, formError: SESSION_EXPIRED_MESSAGE }
  const wait = await deps.limited(did)
  if (wait) return { values, formError: wait }
  if (!deps.enabled) return { values, formError: 'Custom domains are not available yet.' }
  if (!(await deps.isPlus(did))) return { values, formError: 'Custom profile domains are part of the Plus plan.' }
  if (await deps.hasDomain(did)) return { values, formError: 'Remove your current domain before adding another.' }
  const v = deps.validate(values.hostname)
  if (!v.ok) return { values, errors: { hostname: v.error } }
  const r = await deps.add(did, v.value)
  if (!r.ok) return r.field ? { values, errors: { hostname: r.error } } : { values, formError: r.error }
  return { done: 'Domain added.' }
}
