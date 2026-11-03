import { getPool } from './store'
import type { DomainStatus } from './cf-saas'

export type DomainRow = { did: string; hostname: string; cfId: string; status: DomainStatus; createdAt: Date; verifiedAt: Date | null }

export interface DomainStore {
  get(did: string): Promise<DomainRow | undefined>
  /** Returns false when the hostname or the DID already has a row. */
  insert(did: string, hostname: string, cfId: string): Promise<boolean>
  setStatus(did: string, status: DomainStatus): Promise<void>
  remove(did: string): Promise<void>
  /** Handle (or DID when no handle is indexed) for a verified hostname, else null. */
  profileFor(hostname: string): Promise<string | null>
}

function memory(): DomainStore {
  const rows = new Map<string, DomainRow>()
  return {
    async get(did) {
      return rows.get(did)
    },
    async insert(did, hostname, cfId) {
      if (rows.has(did) || [...rows.values()].some((r) => r.hostname === hostname)) return false
      rows.set(did, { did, hostname, cfId, status: 'pending', createdAt: new Date(), verifiedAt: null })
      return true
    },
    async setStatus(did, status) {
      const r = rows.get(did)
      if (r) rows.set(did, { ...r, status, verifiedAt: status === 'active' ? (r.verifiedAt ?? new Date()) : null })
    },
    async remove(did) {
      rows.delete(did)
    },
    async profileFor(hostname) {
      const r = [...rows.values()].find((x) => x.hostname === hostname && x.status === 'active')
      return r ? r.did : null
    },
  }
}

const toRow = (x: Record<string, unknown>): DomainRow => ({
  did: x.did as string,
  hostname: x.hostname as string,
  cfId: x.cf_id as string,
  status: x.status as DomainStatus,
  createdAt: x.created_at as Date,
  verifiedAt: (x.verified_at as Date | null) ?? null,
})

function postgres(pool: NonNullable<ReturnType<typeof getPool>>): DomainStore {
  return {
    async get(did) {
      const r = await pool.query('SELECT * FROM custom_domains WHERE did = $1', [did])
      return r.rows[0] ? toRow(r.rows[0]) : undefined
    },
    async insert(did, hostname, cfId) {
      const r = await pool.query('INSERT INTO custom_domains (did, hostname, cf_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [did, hostname, cfId])
      return (r.rowCount ?? 0) > 0
    },
    async setStatus(did, status) {
      await pool.query(
        `UPDATE custom_domains SET status = $2,
           verified_at = CASE WHEN $2 = 'active' THEN COALESCE(verified_at, now()) ELSE NULL END
         WHERE did = $1`,
        [did, status],
      )
    },
    async remove(did) {
      await pool.query('DELETE FROM custom_domains WHERE did = $1', [did])
    },
    async profileFor(hostname) {
      const r = await pool.query(
        `SELECT COALESCE(p.handle, d.did) AS id FROM custom_domains d LEFT JOIN repos p ON p.did = d.did
         WHERE d.hostname = $1 AND d.status = 'active' AND COALESCE(p.active, true)`,
        [hostname],
      )
      return (r.rows[0]?.id as string | undefined) ?? null
    },
  }
}

const g = globalThis as { __bvDomains?: DomainStore }

export function getDomainStore(): DomainStore {
  const pool = getPool()
  g.__bvDomains ??= pool ? postgres(pool) : memory()
  return g.__bvDomains
}
