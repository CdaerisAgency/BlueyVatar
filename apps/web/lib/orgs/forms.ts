import { SESSION_EXPIRED_MESSAGE } from '../form-state'
import type { AddMemberState, CreateOrgState } from './form-limits'
import { DID_RE, isRole, type Role } from './roles'

const NO_DB = 'Organizations need the database, which is not configured here.'
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export type CreateOrgDeps = {
  limited: (did: string) => Promise<string | null>
  hasDb: boolean
  validName: (raw: string) => string | null
  create: (did: string, name: string) => Promise<Result<{ orgId: string }>>
}

/** Failures return the typed name. Success returns `done` with the new organization id, and the action redirects. */
export async function runCreateOrg(did: string | null, form: FormData, deps: CreateOrgDeps): Promise<CreateOrgState & { orgId?: string }> {
  const values = { name: String(form.get('name') ?? '') }
  if (!did) return { values, sessionExpired: true, formError: SESSION_EXPIRED_MESSAGE }
  if (!deps.validName(values.name)) return { values, errors: { name: 'Enter an organization name of 1 to 80 characters, such as Acme Design.' } }
  const wait = await deps.limited(did)
  if (wait) return { values, formError: wait }
  if (!deps.hasDb) return { values, formError: NO_DB }
  const r = await deps.create(did, values.name)
  if (!r.ok) return { values, formError: r.error }
  return { orgId: r.orgId }
}

export type AddMemberDeps = {
  limited: (did: string) => Promise<string | null>
  hasDb: boolean
  roleOf: (orgId: string, did: string) => Promise<Role | null>
  canManage: (role: Role | null) => boolean
  add: (orgId: string, actor: string, target: string, role: Role) => Promise<Result>
}

/** Failures return the typed DID and role. Success clears the form. */
export async function runAddMember(did: string | null, form: FormData, deps: AddMemberDeps): Promise<AddMemberState> {
  const values = { member: String(form.get('member') ?? ''), role: String(form.get('role') ?? 'member') }
  if (!did) return { values, sessionExpired: true, formError: SESSION_EXPIRED_MESSAGE }
  const orgId = String(form.get('org') ?? '')
  const target = values.member.trim()
  const errors: AddMemberState['errors'] = {}
  if (!DID_RE.test(target)) errors.member = 'Enter a valid atproto DID, such as did:plc:abc123.'
  if (!isRole(values.role)) errors.role = 'Choose member or owner.'
  if (errors.member || errors.role) return { values, errors }
  const wait = await deps.limited(did)
  if (wait) return { values, formError: wait }
  if (!deps.hasDb) return { values, formError: NO_DB }
  if (!deps.canManage(await deps.roleOf(orgId, did))) return { values, formError: 'Only organization owners can change membership.' }
  const r = await deps.add(orgId, did, target, values.role as Role)
  if (!r.ok) return { values, ...(/already a member/.test(r.error) ? { errors: { member: r.error } } : { formError: r.error }) }
  return { done: 'Member added.' }
}
