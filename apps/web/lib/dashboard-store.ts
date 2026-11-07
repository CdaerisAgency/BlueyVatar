import { randomUUID } from 'node:crypto'
import { ENTITLEMENTS, effectiveTier, type Tier } from '@blueyvatar/core'
import type pg from 'pg'
import type { KeyKind } from './keys'
import { getPool } from './store'
import { PUBLIC_RULES, type VisibilityRules } from './visibility'

export interface LicenseRow {
  licenseId: string
  owner: string
  tier: Tier
  status: 'active' | 'past_due' | 'suspended' | 'canceled'
  term: 'monthly' | 'annual'
  /** Set while past due. After this instant `tier` already reads as Free. */
  graceEndsAt?: Date | null
}

export interface KeyRow {
  hash: string
  prefix: string
  kind: KeyKind
  label: string | null
  domains: string[]
  createdAt: Date
  revokedAt: Date | null
}

export interface NewKey {
  kind: KeyKind
  label: string | null
  hash: string
  prefix: string
  domains: string[]
}

/** Runs inside the same lock as the insert so two requests cannot both pass the limit. */
export type KeyGuard = (active: KeyRow[]) => string | null

export interface DashboardStore {
  /** Finds the DID's license, issuing a Free one on first call. */
  ensureLicense(did: string): Promise<LicenseRow>
  listKeys(licenseId: string): Promise<KeyRow[]>
  /** Counter totals keyed by `${period}|${meter}`. */
  usage(licenseId: string, periods: string[]): Promise<Map<string, number>>
  alertsSent(licenseId: string, period: string): Promise<number[]>
  /** Inserts a key, and revokes `replace` in the same step. Returns an error message on a guard failure. */
  createKey(licenseId: string, key: NewKey, guard: KeyGuard, replace?: string): Promise<string | null>
  revokeKey(licenseId: string, hash: string): Promise<boolean>
  setDomains(licenseId: string, hash: string, domains: string[]): Promise<boolean>
  getRules(did: string): Promise<VisibilityRules>
  setRules(did: string, rules: VisibilityRules): Promise<void>
}

const newLicenseId = () => `lic_${randomUUID()}`

function memory(): DashboardStore {
  const licenses = new Map<string, LicenseRow>()
  const keys = new Map<string, KeyRow & { licenseId: string }>()
  const rules = new Map<string, VisibilityRules>()
  const active = (id: string) => [...keys.values()].filter((k) => k.licenseId === id && !k.revokedAt)
  return {
    async ensureLicense(did) {
      let l = licenses.get(did)
      if (!l) {
        l = { licenseId: newLicenseId(), owner: did, tier: 'free', status: 'active', term: 'monthly' }
        licenses.set(did, l)
      }
      return l
    },
    async listKeys(id) {
      return [...keys.values()].filter((k) => k.licenseId === id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    },
    async usage() {
      return new Map()
    },
    async alertsSent() {
      return []
    },
    async createKey(id, key, guard, replace) {
      const err = guard(active(id))
      if (err) return err
      keys.set(key.hash, { ...key, licenseId: id, createdAt: new Date(), revokedAt: null })
      const old = replace ? keys.get(replace) : undefined
      if (old && old.licenseId === id) old.revokedAt = new Date()
      return null
    },
    async revokeKey(id, hash) {
      const k = keys.get(hash)
      if (!k || k.licenseId !== id || k.revokedAt) return false
      k.revokedAt = new Date()
      return true
    },
    async setDomains(id, hash, domains) {
      const k = keys.get(hash)
      if (!k || k.licenseId !== id || k.revokedAt || k.kind !== 'publishable') return false
      k.domains = domains
      return true
    },
    async getRules(did) {
      return rules.get(did) ?? PUBLIC_RULES
    },
    async setRules(did, r) {
      rules.set(did, r)
    },
  }
}

const keyCols = 'key_hash, prefix, kind, label, domains, created_at, revoked_at'
const toKey = (r: Record<string, unknown>): KeyRow => ({
  hash: r.key_hash as string,
  prefix: r.prefix as string,
  kind: r.kind as KeyKind,
  label: (r.label as string | null) ?? null,
  domains: r.domains as string[],
  createdAt: r.created_at as Date,
  revokedAt: (r.revoked_at as Date | null) ?? null,
})

async function inTx<T>(pool: pg.Pool, did: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    // Serializes work per owner. No unique index on licenses.owner exists, so this guards first-visit issuing too.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`license:${did}`])
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

function postgres(pool: pg.Pool): DashboardStore {
  const readLicense = async (q: { query: pg.Pool['query'] }, did: string): Promise<LicenseRow | undefined> => {
    const r = await q.query('SELECT license_id, owner, tier, status, term, grace_ends_at FROM licenses WHERE owner = $1 ORDER BY created_at LIMIT 1', [did])
    const x = r.rows[0]
    // A past-due license reads as Free once its grace period ends, with no webhook needed (spec section 12).
    return x && { licenseId: x.license_id, owner: x.owner, tier: effectiveTier({ tier: x.tier, status: x.status, graceEndsAt: x.grace_ends_at }, new Date()), status: x.status, term: x.term, graceEndsAt: x.grace_ends_at }
  }
  return {
    async ensureLicense(did) {
      const found = await readLicense(pool, did)
      if (found) return found
      return inTx(pool, did, async (c) => {
        const again = await readLicense(c, did)
        if (again) return again
        const id = newLicenseId()
        await c.query(
          `INSERT INTO licenses (license_id, owner, tier, status, term, attribution_required, entitlements)
           VALUES ($1, $2, 'free', 'active', 'monthly', true, $3)`,
          [id, did, JSON.stringify(ENTITLEMENTS.free)],
        )
        return { licenseId: id, owner: did, tier: 'free' as const, status: 'active' as const, term: 'monthly' as const }
      })
    },
    async listKeys(id) {
      const r = await pool.query(`SELECT ${keyCols} FROM api_keys WHERE license_id = $1 ORDER BY created_at DESC`, [id])
      return r.rows.map(toKey)
    },
    async usage(id, periods) {
      const out = new Map<string, number>()
      if (periods.length === 0) return out
      const r = await pool.query(
        'SELECT meter, period_start::text AS period, count FROM usage_counters WHERE license_id = $1 AND period_start = ANY($2::date[])',
        [id, periods],
      )
      for (const x of r.rows) out.set(`${x.period}|${x.meter}`, Number(x.count))
      return out
    },
    async alertsSent(id, period) {
      const r = await pool.query('SELECT threshold FROM usage_alerts WHERE license_id = $1 AND period_start = $2 ORDER BY threshold', [id, period])
      return r.rows.map((x) => Number(x.threshold))
    },
    async createKey(id, key, guard, replace) {
      const owner = (await pool.query('SELECT owner FROM licenses WHERE license_id = $1', [id])).rows[0]?.owner as string | undefined
      if (!owner) return 'License not found.'
      return inTx(pool, owner, async (c) => {
        const cur = await c.query(`SELECT ${keyCols} FROM api_keys WHERE license_id = $1 AND revoked_at IS NULL`, [id])
        const err = guard(cur.rows.map(toKey))
        if (err) return err
        await c.query(
          'INSERT INTO api_keys (key_hash, prefix, license_id, kind, label, domains) VALUES ($1, $2, $3, $4, $5, $6)',
          [key.hash, key.prefix, id, key.kind, key.label, key.domains],
        )
        if (replace) await c.query('UPDATE api_keys SET revoked_at = now() WHERE license_id = $1 AND key_hash = $2 AND revoked_at IS NULL', [id, replace])
        return null
      })
    },
    async revokeKey(id, hash) {
      const r = await pool.query('UPDATE api_keys SET revoked_at = now() WHERE license_id = $1 AND key_hash = $2 AND revoked_at IS NULL', [id, hash])
      return (r.rowCount ?? 0) > 0
    },
    async setDomains(id, hash, domains) {
      const r = await pool.query(
        "UPDATE api_keys SET domains = $3 WHERE license_id = $1 AND key_hash = $2 AND revoked_at IS NULL AND kind = 'publishable'",
        [id, hash, domains],
      )
      return (r.rowCount ?? 0) > 0
    },
    async getRules(did) {
      const r = await pool.query(
        'SELECT keyed_only, domain_allowlist, hidden_profile, email_lookup_opt_out FROM visibility_rules WHERE did = $1',
        [did],
      )
      const x = r.rows[0]
      if (!x) return PUBLIC_RULES
      return { keyedOnly: x.keyed_only, domainAllowlist: x.domain_allowlist, hiddenProfile: x.hidden_profile, emailLookupOptOut: x.email_lookup_opt_out }
    },
    async setRules(did, r) {
      await pool.query(
        `INSERT INTO visibility_rules (did, keyed_only, domain_allowlist, hidden_profile, email_lookup_opt_out)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (did) DO UPDATE SET keyed_only = EXCLUDED.keyed_only, domain_allowlist = EXCLUDED.domain_allowlist,
           hidden_profile = EXCLUDED.hidden_profile, email_lookup_opt_out = EXCLUDED.email_lookup_opt_out, updated_at = now()`,
        [did, r.keyedOnly, r.domainAllowlist, r.hiddenProfile, r.emailLookupOptOut],
      )
    },
  }
}

const g = globalThis as { __bvDash?: DashboardStore }

export function getDashboardStore(): DashboardStore {
  const pool = getPool()
  g.__bvDash ??= pool ? postgres(pool) : memory()
  return g.__bvDash
}
