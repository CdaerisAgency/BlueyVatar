'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { cfSaasConfig, createHostname, deleteHostname, fallbackOrigin, CfError } from '../../../lib/cf-saas'
import { getDomainStore } from '../../../lib/domain-store'
import { validateCustomHostname } from '../../../lib/domains'
import { resolvePlan } from '../../../lib/plan'
import { limited } from '../../../lib/rate-guard'
import { runAddDomain } from '../../../lib/domain-form'
import type { DomainState } from '../../../lib/domain-limits'

const back = (error?: string): never => redirect(error ? `/account/domain?error=${encodeURIComponent(error)}` : '/account/domain')

function reservedHosts(): string[] {
  const out = [fallbackOrigin() ?? '']
  try {
    out.push(new URL(process.env.PUBLIC_URL ?? '').hostname)
  } catch {
    // PUBLIC_URL unset or invalid
  }
  return out
}

/** Failures return to the form so the typed hostname stays. */
export async function addDomain(_prev: DomainState, form: FormData): Promise<DomainState> {
  const cfg = cfSaasConfig()
  const store = getDomainStore()
  const r = await runAddDomain(await currentDid(), form, {
    limited: (did) => limited(['domain.did', 'domain.ip'], did),
    enabled: cfg !== null,
    isPlus: async (did) => (await resolvePlan(did)) === 'plus',
    hasDomain: async (did) => Boolean(await store.get(did)),
    validate: (h) => validateCustomHostname(h, reservedHosts()),
    add: async (did, hostname) => {
      let id: string
      try {
        id = (await createHostname(cfg!, hostname)).id
      } catch (err) {
        return { ok: false, error: err instanceof CfError ? `Cloudflare could not add that hostname: ${err.message}` : 'Could not reach Cloudflare. Try again later.' }
      }
      if (!(await store.insert(did, hostname, id))) {
        await deleteHostname(cfg!, id).catch(() => undefined)
        return { ok: false, error: 'That hostname is already in use.', field: true }
      }
      return { ok: true }
    },
  })
  if (r.done) return back()
  return r
}

export async function removeDomain(): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const wait = await limited(['domain.did', 'domain.ip'], did)
  if (wait) return back(wait)
  const store = getDomainStore()
  const row = await store.get(did)
  if (row) {
    const cfg = cfSaasConfig()
    if (cfg) {
      try {
        await deleteHostname(cfg, row.cfId)
      } catch {
        return back('Could not remove the hostname from Cloudflare. Try again later.')
      }
    }
    await store.remove(did)
  }
  return back()
}
