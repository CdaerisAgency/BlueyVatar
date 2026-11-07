import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteAccountData, DeletionBlocked, exportAccountData, ORG_BILLING_BLOCK } from '../account-data'
import { postgresBillingStore } from '../billing/store'
import { applyEvent } from '../billing/webhook'
import { canManageBilling, canManageKeys, canManageMembership, checkChange, DID_RE, type Member } from './roles'
import { addMember, createOrganization, listAudit, listMembers, listOrganizations, memberRole, orgLicense, removeMember, setRole } from './store'

describe('roles', () => {
  it('lets members manage keys and only owners manage billing and membership', () => {
    expect([canManageKeys('owner'), canManageKeys('member'), canManageKeys(null)]).toEqual([true, true, false])
    expect([canManageMembership('owner'), canManageMembership('member'), canManageMembership(null)]).toEqual([true, false, false])
    expect([canManageBilling('owner'), canManageBilling('member'), canManageBilling(null)]).toEqual([true, false, false])
  })
  it('accepts DIDs only', () => {
    expect(DID_RE.test('did:plc:abc123')).toBe(true)
    expect(DID_RE.test('did:web:example.com')).toBe(true)
    expect(DID_RE.test('bob@example.com')).toBe(false)
    expect(DID_RE.test('bob.bsky.social')).toBe(false)
  })
  it('keeps one owner and the billing owner', () => {
    const solo: Member[] = [{ did: 'a', role: 'owner' }, { did: 'b', role: 'member' }]
    expect(checkChange(solo, 'a', { kind: 'remove', did: 'a' })).toMatch(/at least one owner/)
    expect(checkChange(solo, 'a', { kind: 'role', did: 'a', role: 'member' })).toMatch(/at least one owner/)
    expect(checkChange(solo, 'a', { kind: 'remove', did: 'b' })).toBeNull()
    expect(checkChange(solo, 'a', { kind: 'remove', did: 'zz' })).toMatch(/not a member/)
    const two: Member[] = [{ did: 'a', role: 'owner' }, { did: 'b', role: 'owner' }]
    expect(checkChange(two, 'a', { kind: 'remove', did: 'b' })).toBeNull()
    expect(checkChange(two, 'a', { kind: 'remove', did: 'a' })).toMatch(/billing owner/)
    expect(checkChange(two, 'a', { kind: 'role', did: 'a', role: 'member' })).toMatch(/billing owner/)
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_orgs_${process.pid}_${Date.now()}`
const A = 'did:plc:alice'
const B = 'did:plc:bob'
const C = 'did:plc:carol'

describe.skipIf(!url)('organizations', () => {
  let pool: pg.Pool
  const n = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0].c as number

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const dir = new URL('../../../../db/migrations/', import.meta.url)
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(readFileSync(new URL(f, dir), 'utf8'))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('creates an organization with an owner, a Free license, and an audit entry', async () => {
    const r = await createOrganization(pool, A, '  Acme   Inc ')
    if (!r.ok) throw new Error(r.error)
    expect(await memberRole(pool, r.orgId, A)).toBe('owner')
    const lic = await orgLicense(pool, r.orgId)
    expect(lic?.billingDid).toBe(A)
    expect((await pool.query('SELECT tier, org_id FROM licenses WHERE license_id = $1', [lic!.licenseId])).rows[0]).toEqual({ tier: 'free', org_id: r.orgId })
    expect((await listOrganizations(pool, A))[0]).toMatchObject({ name: 'Acme Inc', role: 'owner' })
    expect((await listAudit(pool, r.orgId)).map((a) => a.action)).toEqual(['org_created'])
    expect((await createOrganization(pool, A, '   ')).ok).toBe(false)
  })

  it('adds members by DID only, changes roles, removes, and audits each change', async () => {
    const orgId = (await listOrganizations(pool, A))[0]!.orgId
    expect((await addMember(pool, orgId, A, 'bob@example.com')).ok).toBe(false)
    expect((await addMember(pool, orgId, A, B)).ok).toBe(true)
    expect((await addMember(pool, orgId, A, B))).toEqual({ ok: false, error: 'That account is already a member.' })
    expect(await memberRole(pool, orgId, B)).toBe('member')
    expect((await setRole(pool, orgId, A, B, 'owner')).ok).toBe(true)
    expect((await setRole(pool, orgId, A, B, 'member')).ok).toBe(true)
    expect((await removeMember(pool, orgId, A, B)).ok).toBe(true)
    expect(await memberRole(pool, orgId, B)).toBeNull()
    const actions = (await listAudit(pool, orgId)).map((a) => a.action).reverse()
    expect(actions).toEqual(['org_created', 'member_added', 'role_changed', 'role_changed', 'member_removed'])
  })

  it('refuses to remove or demote the last owner, but a member can leave', async () => {
    const orgId = (await listOrganizations(pool, A))[0]!.orgId
    await addMember(pool, orgId, A, B)
    const r1 = await removeMember(pool, orgId, A, A)
    expect(r1.ok).toBe(false)
    expect((await setRole(pool, orgId, A, A, 'member')).ok).toBe(false)
    expect((await listMembers(pool, orgId)).filter((m) => m.role === 'owner').map((m) => m.did)).toEqual([A])
    expect((await removeMember(pool, orgId, B, B)).ok).toBe(true)
    expect((await listAudit(pool, orgId))[0]!.action).toBe('member_left')
  })

  it('keeps an organization license out of the personal license lookup', async () => {
    const store = postgresBillingStore(pool)
    await store.process('evt_p1', 'x', async (tx) => {
      const personal = await tx.ensureLicense(A)
      const org = (await orgLicense(pool, (await listOrganizations(pool, A))[0]!.orgId))!
      expect(personal.licenseId).not.toBe(org.licenseId)
    })
  })

  it('ties a Business subscription to the organization license through Checkout metadata', async () => {
    const orgId = (await listOrganizations(pool, A))[0]!.orgId
    const lic = (await orgLicense(pool, orgId))!
    const store = postgresBillingStore(pool)
    const env = { STRIPE_PRICE_BUSINESS: 'price_biz' }
    const sub = { id: 'sub_org', customer: 'cus_a', status: 'active', metadata: { did: A, license_id: lic.licenseId }, items: { data: [{ price: { id: 'price_biz' }, current_period_end: 2_000_000_000 }] } }
    await store.process('evt_org', 'customer.subscription.created', async (tx) => {
      await applyEvent(tx, { id: 'evt_org', type: 'customer.subscription.created', created: 1_900_000_000, data: { object: sub } } as never, new Date(1_900_000_100_000), env)
    })
    expect((await pool.query('SELECT tier FROM licenses WHERE license_id = $1', [lic.licenseId])).rows[0].tier).toBe('business')
    expect((await pool.query("SELECT tier FROM licenses WHERE owner = $1 AND org_id IS NULL", [A])).rows[0].tier).toBe('free')
    expect((await store.subscriptionFor(A, 'developer', lic.licenseId))?.id).toBe('sub_org')
    expect(await store.subscriptionFor(A, 'developer', 'lic_other')).toBeNull()
  })

  it('exports memberships and audit rows', async () => {
    const out = await exportAccountData(pool, A)
    expect(out.organizations.memberships).toHaveLength(1)
    expect(out.organizations.audit.length).toBeGreaterThan(0)
  })

  it('blocks deletion for a billing owner who still has co-members, before anything is removed', async () => {
    const orgId = (await listOrganizations(pool, A))[0]!.orgId
    await addMember(pool, orgId, A, B)
    let canceled = 0
    await expect(deleteAccountData(pool, A, { cancelSubscription: async () => void canceled++ })).rejects.toThrow(ORG_BILLING_BLOCK)
    await expect(deleteAccountData(pool, A)).rejects.toBeInstanceOf(DeletionBlocked)
    expect(canceled).toBe(0)
    expect(await n('SELECT count(*)::int AS c FROM organizations')).toBe(1)
  })

  it('removes a leaving member from an organization and scrubs their DID from its history', async () => {
    const orgId = (await listOrganizations(pool, A))[0]!.orgId
    await addMember(pool, orgId, A, C)
    await pool.query("INSERT INTO organization_audit (org_id, actor, action, target_did) VALUES ($1, $2, 'key_created', $2)", [orgId, C])
    await deleteAccountData(pool, C)
    expect(await memberRole(pool, orgId, C)).toBeNull()
    expect(await n('SELECT count(*)::int AS c FROM organization_audit WHERE actor = $1 OR target_did = $1', [C])).toBe(0)
    expect(await n('SELECT count(*)::int AS c FROM organization_members WHERE added_by = $1', [C])).toBe(0)
    expect(await n('SELECT count(*)::int AS c FROM organizations WHERE org_id = $1', [orgId])).toBe(1)
    expect((await listAudit(pool, orgId))[0]).toMatchObject({ action: 'member_left', actor: null })
  })

  it('deletes an organization with its license and keys when its billing owner is the last member, and keeps billing rows', async () => {
    const orgId = (await listOrganizations(pool, A))[0]!.orgId
    const lic = (await orgLicense(pool, orgId))!
    await pool.query("INSERT INTO api_keys (key_hash, prefix, license_id, kind) VALUES ($1, 'sk_x', $2, 'secret')", ['e'.repeat(64), lic.licenseId])
    await removeMember(pool, orgId, A, B)
    await deleteAccountData(pool, A)
    expect(await n('SELECT count(*)::int AS c FROM organizations WHERE org_id = $1', [orgId])).toBe(0)
    expect(await n('SELECT count(*)::int AS c FROM licenses WHERE org_id = $1', [orgId])).toBe(0)
    expect(await n('SELECT count(*)::int AS c FROM api_keys WHERE license_id = $1', [lic.licenseId])).toBe(0)
    const sub = (await pool.query("SELECT status, deleted_at FROM subscriptions WHERE stripe_subscription_id = 'sub_org'")).rows[0]
    expect(sub.status).toBe('canceled')
    expect(sub.deleted_at).toBeInstanceOf(Date)
  })
})
