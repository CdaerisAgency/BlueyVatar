'use server'

import { ENTITLEMENTS } from '@blueyvatar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { getDashboardStore, type KeyRow } from '../../../lib/dashboard-store'
import { limited } from '../../../lib/rate-guard'
import { checkKeyLimit, cleanLabel, displayPrefix, generateKey, hashKey, parseDomainList, type KeyKind } from '../../../lib/keys'

export interface KeyState {
  error?: string
  message?: string
  /** The full key. Returned to the browser once and never stored. */
  key?: string
  keyKind?: KeyKind
}

async function ctx() {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const store = getDashboardStore()
  return { did, store, license: await store.ensureLicense(did) }
}

const asKind = (v: FormDataEntryValue | null): KeyKind | null => (v === 'secret' || v === 'publishable' ? v : null)
const guardFor = (tier: Parameters<typeof checkKeyLimit>[0], kind: KeyKind, replacing?: string) => (active: KeyRow[]) => {
  const r = checkKeyLimit(tier, kind, active, replacing)
  return r.ok ? null : r.error
}

async function issue(kind: KeyKind, label: string | null, domains: string[], replace?: string): Promise<KeyState> {
  const { did, store, license } = await ctx()
  const wait = await limited(['key.did', 'key.ip'], did)
  if (wait) return { error: wait }
  if (license.status !== 'active') return { error: `This license is ${license.status.replace('_', ' ')}. Keys cannot be issued.` }
  const key = generateKey(kind)
  const err = await store.createKey(
    license.licenseId,
    { kind, label, hash: hashKey(key), prefix: displayPrefix(key), domains },
    guardFor(license.tier, kind, replace),
    replace,
  )
  if (err) return { error: err }
  revalidatePath('/account/keys')
  return { key, keyKind: kind, message: replace ? 'Key rotated. The old key is revoked.' : 'Key created.' }
}

export async function createKey(_prev: KeyState, form: FormData): Promise<KeyState> {
  const kind = asKind(form.get('kind'))
  if (!kind) return { error: 'Choose a key type.' }
  return issue(kind, cleanLabel(String(form.get('label') ?? '')), [])
}

/** Creates the replacement first, then revokes the old key, in one transaction. */
export async function rotateKey(_prev: KeyState, form: FormData): Promise<KeyState> {
  const { store, license } = await ctx()
  const hash = String(form.get('hash') ?? '')
  const old = (await store.listKeys(license.licenseId)).find((k) => k.hash === hash && !k.revokedAt)
  if (!old) return { error: 'That key is already revoked or does not exist.' }
  return issue(old.kind, old.label, old.domains, hash)
}

export async function revokeKey(form: FormData): Promise<void> {
  const { store, license } = await ctx()
  await store.revokeKey(license.licenseId, String(form.get('hash') ?? ''))
  revalidatePath('/account/keys')
}

export async function saveDomains(_prev: KeyState, form: FormData): Promise<KeyState> {
  const { store, license } = await ctx()
  if (!ENTITLEMENTS[license.tier].domainRestrictions) return { error: 'Domain restrictions are not included in this tier.' }
  const parsed = parseDomainList(String(form.get('domains') ?? ''))
  if (!parsed.ok) return { error: parsed.errors.join(' ') }
  const ok = await store.setDomains(license.licenseId, String(form.get('hash') ?? ''), parsed.domains)
  if (!ok) return { error: 'Only active publishable keys have a domain list.' }
  revalidatePath('/account/keys')
  return { message: parsed.domains.length ? 'Domains saved.' : 'Domain list cleared. Any host may use this key.' }
}
