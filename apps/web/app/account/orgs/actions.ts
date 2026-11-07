'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { log } from '../../../lib/obs'
import { limited } from '../../../lib/rate-guard'
import { getPool } from '../../../lib/store'
import { canManageMembership, isRole } from '../../../lib/orgs/roles'
import { addMember, createOrganization, memberRole, removeMember, setRole, type OrgResult } from '../../../lib/orgs/store'

const listBack = (error: string): never => redirect(`/account/orgs?error=${encodeURIComponent(error)}`)
const orgBack = (id: string, key: 'error' | 'done', msg: string): never => redirect(`/account/orgs/${encodeURIComponent(id)}?${key}=${encodeURIComponent(msg)}`)

async function ctx() {
  const did = await currentDid()
  if (!did) return redirect('/login?next=%2Faccount%2Forgs')
  return did
}

export async function createOrg(form: FormData): Promise<void> {
  const did = await ctx()
  const wait = await limited(['org.did', 'org.ip'], did)
  if (wait) return listBack(wait)
  const pool = getPool()
  if (!pool) return listBack('Organizations need the database, which is not configured here.')
  const r = await createOrganization(pool, did, String(form.get('name') ?? ''))
  if (!r.ok) return listBack(r.error)
  log.info('organization created')
  return redirect(`/account/orgs/${r.orgId}`)
}

/** Runs an owner-only membership change. `member` is the target DID. Leaving is allowed for any member. */
async function change(form: FormData, run: (orgId: string, actor: string, target: string) => Promise<OrgResult>, ok: string, selfAllowed = false): Promise<void> {
  const did = await ctx()
  const orgId = String(form.get('org') ?? '')
  const target = String(form.get('member') ?? '').trim()
  const wait = await limited(['org.did', 'org.ip'], did)
  if (wait) return orgBack(orgId, 'error', wait)
  const pool = getPool()
  if (!pool) return orgBack(orgId, 'error', 'Organizations need the database, which is not configured here.')
  const role = await memberRole(pool, orgId, did)
  if (!(canManageMembership(role) || (selfAllowed && role && target === did))) return orgBack(orgId, 'error', 'Only organization owners can change membership.')
  const r = await run(orgId, did, target)
  revalidatePath(`/account/orgs/${orgId}`)
  if (!r.ok) return orgBack(orgId, 'error', r.error)
  log.info('organization membership changed')
  if (selfAllowed && target === did) return redirect('/account/orgs')
  return orgBack(orgId, 'done', ok)
}

/** Adds a member by atproto DID. There is no email invite, so nothing needs acceptance and no address is stored. */
export async function addOrgMember(form: FormData): Promise<void> {
  const role = String(form.get('role') ?? 'member')
  return change(form, (o, a, t) => addMember(getPool()!, o, a, t, isRole(role) ? role : 'member'), 'Member added.')
}

export async function changeOrgRole(form: FormData): Promise<void> {
  const role = String(form.get('role') ?? '')
  return change(form, (o, a, t) => (isRole(role) ? setRole(getPool()!, o, a, t, role) : Promise.resolve({ ok: false as const, error: 'Unknown role.' })), 'Role updated.')
}

/** Removes a member, or lets the signed-in member leave. */
export async function removeOrgMember(form: FormData): Promise<void> {
  return change(form, (o, a, t) => removeMember(getPool()!, o, a, t), 'Member removed.', true)
}
