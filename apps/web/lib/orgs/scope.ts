import { getDashboardStore, type LicenseRow } from '../dashboard-store'
import { getPool } from '../store'
import { listOrganizations, listMembers, memberRole, orgLicense, recordOrgAudit, type AuditAction } from './store'
import { canManageBilling, canManageKeys, type Role } from './roles'

/** The license a signed-in DID is working on: their personal one, or an organization's when they are a member. */
export interface Scope {
  license: LicenseRow
  orgId: string | null
  role: Role | null
  /** Records an organization audit entry for this scope. A no-op for a personal license. */
  audit(actor: string, action: AuditAction, target?: string | null, detail?: string | null): Promise<void>
}

export const NOT_A_MEMBER = 'You are not a member of that organization.'

/** Resolves the scope for `orgId` (or the personal license when null). Returns an error message when access is denied. */
export async function resolveScope(did: string, orgId: string | null): Promise<Scope | { error: string }> {
  const store = getDashboardStore()
  if (!orgId) return { license: await store.ensureLicense(did), orgId: null, role: null, audit: async () => {} }
  const pool = getPool()
  if (!pool) return { error: 'Organizations need the database, which is not configured here.' }
  const role = await memberRole(pool, orgId, did)
  if (!canManageKeys(role)) return { error: NOT_A_MEMBER }
  const lic = await orgLicense(pool, orgId)
  const license = lic && (await store.licenseById(lic.licenseId))
  if (!license) return { error: 'Organization not found.' }
  return { license, orgId, role, audit: (actor, action, target, detail) => recordOrgAudit(pool, orgId, actor, action, target, detail) }
}

export const isScope = (s: Scope | { error: string }): s is Scope => !('error' in s)

export { canManageBilling, listOrganizations, listMembers }
