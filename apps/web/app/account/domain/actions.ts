'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { cfSaasConfig, createHostname, deleteHostname, fallbackOrigin, CfError } from '../../../lib/cf-saas'
import { getDomainStore } from '../../../lib/domain-store'
import { validateCustomHostname } from '../../../lib/domains'
import { resolvePlan } from '../../../lib/plan'
import { limited } from '../../../lib/rate-guard'

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

export async function addDomain(form: FormData): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const wait = await limited(['domain.did', 'domain.ip'], did)
  if (wait) return back(wait)
  const cfg = cfSaasConfig()
  if (!cfg) return back('Custom domains are not available yet.')
  if ((await resolvePlan(did)) !== 'plus') return back('Custom profile domains are part of the Plus plan.')
  const store = getDomainStore()
  if (await store.get(did)) return back('Remove your current domain before adding another.')
  const v = validateCustomHostname(String(form.get('hostname') ?? ''), reservedHosts())
  if (!v.ok) return back(v.error)
  let id: string
  try {
    id = (await createHostname(cfg, v.value)).id
  } catch (err) {
    return back(err instanceof CfError ? `Cloudflare could not add that hostname: ${err.message}` : 'Could not reach Cloudflare. Try again later.')
  }
  if (!(await store.insert(did, v.value, id))) {
    await deleteHostname(cfg, id).catch(() => undefined)
    return back('That hostname is already in use.')
  }
  return back()
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
