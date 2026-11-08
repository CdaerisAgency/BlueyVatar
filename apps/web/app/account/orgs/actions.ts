'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { log } from '../../../lib/obs'
import { limited } from '../../../lib/rate-guard'
import { getPool } from '../../../lib/store'
import { canManageMembership, isRole } from '../../../lib/orgs/roles'
import { addMember, cleanName, createOrganization, memberRole, removeMember, setRole, type OrgResult } from '../../../lib/orgs/store'
import { runAddMember, runCreateOrg } from '../../../lib/orgs/forms'
import type { AddMemberState, CreateOrgState } from '../../../lib/orgs/form-limits'

const orgBack = (id: string, key: 'error' | 'done', msg: string): never => redirect(`/account/orgs/${encodeURIComponent(id)}?${key}=${encodeURIComponent(msg)}`)

async function ctx() {
  const did = await currentDid()
  if (!did) return redirect('/login?next=%2Faccount%2Forgs')
  return did
}

/** Failures return to the form so the typed name stays. */
export async function createOrg(_prev: CreateOrgState, form: FormData): Promise<CreateOrgState> {
  const pool = getPool()
  const r = await runCreateOrg(await currentDid(), form, {
    limited: (did) => limited(['org.did', 'org.ip'], did),
    hasDb: pool !== null,
    validName: cleanName,
    create: (did, name) => createOrganization(pool!, did, name),
  })
  if (r.orgId) {
    log.info('organization created')
    return redirect(`/account/orgs/${r.orgId}`)
  }
  return r
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

/** Adds a member by atproto DID. There is no email invite, so nothing needs acceptance and no address is stored. Failures return to the form so the typed values stay. */
export async function addOrgMember(_prev: AddMemberState, form: FormData): Promise<AddMemberState> {
  const pool = getPool()
  const r = await runAddMember(await currentDid(), form, {
    limited: (did) => limited(['org.did', 'org.ip'], did),
    hasDb: pool !== null,
    roleOf: (orgId, did) => memberRole(pool!, orgId, did),
    canManage: canManageMembership,
    add: (orgId, actor, target, role) => addMember(pool!, orgId, actor, target, role),
  })
  if (r.done) {
    revalidatePath(`/account/orgs/${String(form.get('org') ?? '')}`)
    log.info('organization membership changed')
  }
  return r
}

export async function changeOrgRole(form: FormData): Promise<void> {
  const role = String(form.get('role') ?? '')
  return change(form, (o, a, t) => (isRole(role) ? setRole(getPool()!, o, a, t, role) : Promise.resolve({ ok: false as const, error: 'Unknown role.' })), 'Role updated.')
}

/** Removes a member, or lets the signed-in member leave. */
export async function removeOrgMember(form: FormData): Promise<void> {
  return change(form, (o, a, t) => removeMember(getPool()!, o, a, t), 'Member removed.', true)
}
