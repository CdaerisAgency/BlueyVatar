import { randomUUID } from 'node:crypto'
import { ENTITLEMENTS } from '@blueyvatar/core'
import type pg from 'pg'
import { checkChange, DID_RE, isRole, type Member, type Role } from './roles'

export type AuditAction =
  | 'org_created' | 'member_added' | 'member_removed' | 'member_left' | 'role_changed'
  | 'key_created' | 'key_rotated' | 'key_revoked' | 'key_domains_changed'

type Q = Pick<pg.Pool, 'query'>

export interface OrgSummary {
  orgId: string
  name: string
  role: Role
}

export interface OrgLicense {
  licenseId: string
  /** The billing owner: the DID that holds the Stripe customer and appears as the license owner. */
  billingDid: string
}

export interface AuditRow {
  id: number
  actor: string | null
  action: AuditAction
  targetDid: string | null
  detail: string | null
  createdAt: Date
}

export type OrgResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export const MAX_ORGS_PER_OWNER = 10
export const MAX_MEMBERS = 50

export async function recordOrgAudit(q: Q, orgId: string, actor: string | null, action: AuditAction, target?: string | null, detail?: string | null): Promise<void> {
  await q.query('INSERT INTO organization_audit (org_id, actor, action, target_did, detail) VALUES ($1, $2, $3, $4, $5)', [orgId, actor, action, target ?? null, detail ?? null])
}

async function inTx<T>(pool: pg.Pool, orgId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    // Serializes membership changes per organization, so two removals cannot both pass the last-owner check.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`org:${orgId}`])
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

const cleanName = (raw: string): string | null => {
  const s = raw.trim().replace(/\s+/g, ' ')
  return s.length >= 1 && s.length <= 80 ? s : null
}

/** Creates an organization with `did` as its first owner and billing owner, plus its Free license. */
export async function createOrganization(pool: pg.Pool, did: string, rawName: string): Promise<OrgResult<{ orgId: string }>> {
  const name = cleanName(rawName)
  if (!name) return { ok: false, error: 'Enter an organization name of 1 to 80 characters.' }
  const orgId = `org_${randomUUID()}`
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`license:${did}`])
    const n = (await c.query('SELECT count(*)::int AS n FROM organizations WHERE created_by = $1', [did])).rows[0].n as number
    if (n >= MAX_ORGS_PER_OWNER) {
      await c.query('ROLLBACK')
      return { ok: false, error: `You can create up to ${MAX_ORGS_PER_OWNER} organizations.` }
    }
    await c.query('INSERT INTO organizations (org_id, name, created_by) VALUES ($1, $2, $3)', [orgId, name, did])
    await c.query("INSERT INTO organization_members (org_id, did, role, added_by) VALUES ($1, $2, 'owner', $2)", [orgId, did])
    await c.query(
      `INSERT INTO licenses (license_id, owner, tier, status, term, attribution_required, entitlements, org_id)
       VALUES ($1, $2, 'free', 'active', 'monthly', true, $3, $4)`,
      [`lic_${randomUUID()}`, did, JSON.stringify(ENTITLEMENTS.free), orgId],
    )
    await recordOrgAudit(c, orgId, did, 'org_created', null, name)
    await c.query('COMMIT')
    return { ok: true, orgId }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

export async function listOrganizations(q: Q, did: string): Promise<OrgSummary[]> {
  const r = await q.query('SELECT o.org_id, o.name, m.role FROM organization_members m JOIN organizations o ON o.org_id = m.org_id WHERE m.did = $1 ORDER BY o.created_at', [did])
  return r.rows.map((x) => ({ orgId: x.org_id, name: x.name, role: x.role }))
}

export async function memberRole(q: Q, orgId: string, did: string): Promise<Role | null> {
  const r = await q.query('SELECT role FROM organization_members WHERE org_id = $1 AND did = $2', [orgId, did])
  return r.rows[0]?.role ?? null
}

export async function getOrganization(q: Q, orgId: string): Promise<{ orgId: string; name: string } | null> {
  const r = await q.query('SELECT org_id, name FROM organizations WHERE org_id = $1', [orgId])
  return r.rows[0] ? { orgId: r.rows[0].org_id, name: r.rows[0].name } : null
}

export async function orgLicense(q: Q, orgId: string): Promise<OrgLicense | null> {
  const r = await q.query('SELECT license_id, owner FROM licenses WHERE org_id = $1', [orgId])
  return r.rows[0] ? { licenseId: r.rows[0].license_id, billingDid: r.rows[0].owner } : null
}

export async function listMembers(q: Q, orgId: string): Promise<Array<Member & { addedBy: string; addedAt: Date }>> {
  const r = await q.query("SELECT did, role, added_by, added_at FROM organization_members WHERE org_id = $1 ORDER BY (role = 'owner') DESC, added_at, did", [orgId])
  return r.rows.map((x) => ({ did: x.did, role: x.role, addedBy: x.added_by, addedAt: x.added_at }))
}

export async function listAudit(q: Q, orgId: string, limit = 50): Promise<AuditRow[]> {
  const r = await q.query('SELECT id, actor, action, target_did, detail, created_at FROM organization_audit WHERE org_id = $1 ORDER BY id DESC LIMIT $2', [orgId, limit])
  return r.rows.map((x) => ({ id: Number(x.id), actor: x.actor, action: x.action, targetDid: x.target_did, detail: x.detail, createdAt: x.created_at }))
}

/** Adds a member by DID. The caller has already checked that `actor` is an owner. Members are added directly: no invite or email. */
export async function addMember(pool: pg.Pool, orgId: string, actor: string, did: string, role: Role = 'member'): Promise<OrgResult> {
  const target = did.trim()
  if (!DID_RE.test(target)) return { ok: false, error: 'Enter a valid atproto DID, such as did:plc:abc123.' }
  if (!isRole(role)) return { ok: false, error: 'Unknown role.' }
  return inTx(pool, orgId, async (c) => {
    if (!(await getOrganization(c, orgId))) return { ok: false as const, error: 'Organization not found.' }
    const count = (await c.query('SELECT count(*)::int AS n FROM organization_members WHERE org_id = $1', [orgId])).rows[0].n as number
    if (count >= MAX_MEMBERS) return { ok: false as const, error: `An organization can have up to ${MAX_MEMBERS} members.` }
    const ins = await c.query('INSERT INTO organization_members (org_id, did, role, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [orgId, target, role, actor])
    if ((ins.rowCount ?? 0) === 0) return { ok: false as const, error: 'That account is already a member.' }
    await recordOrgAudit(c, orgId, actor, 'member_added', target, role)
    return { ok: true as const }
  })
}

/** Removes a member, or lets a member leave. Enforces the last-owner and billing-owner rules. */
export async function removeMember(pool: pg.Pool, orgId: string, actor: string, did: string): Promise<OrgResult> {
  return inTx(pool, orgId, async (c) => {
    const lic = await orgLicense(c, orgId)
    if (!lic) return { ok: false as const, error: 'Organization not found.' }
    const err = checkChange(await listMembers(c, orgId), lic.billingDid, { kind: 'remove', did })
    if (err) return { ok: false as const, error: err }
    await c.query('DELETE FROM organization_members WHERE org_id = $1 AND did = $2', [orgId, did])
    await recordOrgAudit(c, orgId, actor, actor === did ? 'member_left' : 'member_removed', did)
    return { ok: true as const }
  })
}

export async function setRole(pool: pg.Pool, orgId: string, actor: string, did: string, role: Role): Promise<OrgResult> {
  if (!isRole(role)) return { ok: false, error: 'Unknown role.' }
  return inTx(pool, orgId, async (c) => {
    const lic = await orgLicense(c, orgId)
    if (!lic) return { ok: false as const, error: 'Organization not found.' }
    const members = await listMembers(c, orgId)
    const err = checkChange(members, lic.billingDid, { kind: 'role', did, role })
    if (err) return { ok: false as const, error: err }
    if (members.find((m) => m.did === did)!.role === role) return { ok: true as const }
    await c.query('UPDATE organization_members SET role = $3 WHERE org_id = $1 AND did = $2', [orgId, did, role])
    await recordOrgAudit(c, orgId, actor, 'role_changed', did, role)
    return { ok: true as const }
  })
}
