'use server'

import { ENTITLEMENTS } from '@blueyvatar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { getDashboardStore, type KeyRow } from '../../../lib/dashboard-store'
import { getNotifier } from '../../../lib/notify'
import { PUBLIC_URL } from '../../../lib/oauth'
import { keyRevokedNotice } from '@blueyvatar/core/verification'
import { limited } from '../../../lib/rate-guard'
import { isScope, resolveScope } from '../../../lib/orgs/scope'
import { asExpiryChoice, DEFAULT_EXPIRY, expiryFor } from '../../../lib/key-expiry'
import { checkKeyLimit, cleanLabel, displayPrefix, generateKey, hashKey, parseDomainList, type KeyKind } from '../../../lib/keys'

export interface KeyState {
  error?: string
  message?: string
  /** The full key. Returned to the browser once and never stored. */
  key?: string
  keyKind?: KeyKind
  /** ISO time the new key stops working. Absent for a key that never expires. */
  expiresAt?: string
  /** What the person typed, so a failed submit keeps it. */
  values?: { label: string; expires: string; kind: string }
}

const orgOf = (form: FormData): string | null => String(form.get('org') ?? '') || null

/** The signed-in DID and the license they are working on: their own, or an organization's when `org` is set and they belong to it. */
async function ctx(orgId: string | null) {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const scope = await resolveScope(did, orgId)
  if (!isScope(scope)) return { did, store: getDashboardStore(), error: scope.error }
  return { did, store: getDashboardStore(), license: scope.license, scope }
}

const asKind = (v: FormDataEntryValue | null): KeyKind | null => (v === 'secret' || v === 'publishable' ? v : null)
const guardFor = (tier: Parameters<typeof checkKeyLimit>[0], kind: KeyKind, replacing?: string) => (active: KeyRow[]) => {
  const r = checkKeyLimit(tier, kind, active, replacing)
  return r.ok ? null : r.error
}

async function issue(orgId: string | null, kind: KeyKind, label: string | null, domains: string[], expiresAt: Date | null, replace?: string): Promise<KeyState> {
  const c = await ctx(orgId)
  if (!c.scope) return { error: c.error }
  const { did, store, license, scope } = c
  const wait = await limited(['key.did', 'key.ip'], did)
  if (wait) return { error: wait }
  if (license.status !== 'active') return { error: `This license is ${license.status.replace('_', ' ')}. Keys cannot be issued.` }
  const key = generateKey(kind)
  const err = await store.createKey(
    license.licenseId,
    { kind, label, hash: hashKey(key), prefix: displayPrefix(key), domains, expiresAt },
    guardFor(license.tier, kind, replace),
    replace,
  )
  if (err) return { error: err }
  await scope.audit(did, replace ? 'key_rotated' : 'key_created', null, `${displayPrefix(key)} ${kind}`)
  revalidatePath('/account/keys')
  return { key, keyKind: kind, expiresAt: expiresAt?.toISOString(), message: replace ? 'Key rotated. The old key is revoked.' : 'Key created.' }
}

export async function createKey(_prev: KeyState, form: FormData): Promise<KeyState> {
  const kind = asKind(form.get('kind'))
  if (!kind) return { error: 'Choose a key type.' }
  const now = new Date()
  const rawLabel = String(form.get('label') ?? '')
  const values = { label: rawLabel, expires: String(form.get('expires') ?? DEFAULT_EXPIRY), kind }
  const choice = asExpiryChoice(form.get('expires') ?? DEFAULT_EXPIRY)
  if (!choice) return { error: 'Choose when the key expires.', values }
  // A name is always stored, so lists and emails never show a blank one.
  const label = cleanLabel(rawLabel) ?? `Unnamed key, created ${now.toISOString().slice(0, 10)}`
  const r = await issue(orgOf(form), kind, label, [], expiryFor(choice, now))
  return r.error ? { ...r, values } : r
}

/** Creates the replacement first, then revokes the old key, in one transaction. */
export async function rotateKey(_prev: KeyState, form: FormData): Promise<KeyState> {
  const c = await ctx(orgOf(form))
  if (!c.scope) return { error: c.error }
  const { store, license } = c
  const hash = String(form.get('hash') ?? '')
  const old = (await store.listKeys(license.licenseId)).find((k) => k.hash === hash && !k.revokedAt)
  if (!old) return { error: 'That key is already revoked or does not exist.' }
  // A rotated key that expired gets the default lifetime. A key that never expired keeps that.
  return issue(orgOf(form), old.kind, old.label, old.domains, old.expiresAt ? expiryFor(DEFAULT_EXPIRY, new Date()) : null, hash)
}

export async function revokeKey(form: FormData): Promise<void> {
  const c = await ctx(orgOf(form))
  if (!c.scope) return
  const { did, store, license, scope } = c
  const hash = String(form.get('hash') ?? '')
  const key = (await store.listKeys(license.licenseId)).find((k) => k.hash === hash && !k.revokedAt)
  // revokeKey is true only for the call that revoked it, so a repeated submit sends one notice.
  if ((await store.revokeKey(license.licenseId, hash)) && key) {
    await scope.audit(did, 'key_revoked', null, `${key.prefix} ${key.kind}`)
    await getNotifier().send(license.owner, 'security', keyRevokedNotice({ did: license.owner, prefix: key.prefix, label: key.label, publicUrl: PUBLIC_URL }))
  }
  revalidatePath('/account/keys')
}

export async function saveDomains(_prev: KeyState, form: FormData): Promise<KeyState> {
  const c = await ctx(orgOf(form))
  if (!c.scope) return { error: c.error }
  const { did, store, license, scope } = c
  if (!ENTITLEMENTS[license.tier].domainRestrictions) return { error: 'Domain restrictions are not included in this tier.' }
  const parsed = parseDomainList(String(form.get('domains') ?? ''))
  if (!parsed.ok) return { error: parsed.errors.join(' ') }
  const ok = await store.setDomains(license.licenseId, String(form.get('hash') ?? ''), parsed.domains)
  if (!ok) return { error: 'Only active publishable keys have a domain list.' }
  await scope.audit(did, 'key_domains_changed', null, `${parsed.domains.length} domains`)
  revalidatePath('/account/keys')
  return { message: parsed.domains.length ? 'Domains saved.' : 'Domain list cleared. Any host may use this key.' }
}
