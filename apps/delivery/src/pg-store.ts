import { createHash } from 'node:crypto'
import { isRating, type Tier } from '@blueyvatar/core'
import pg from 'pg'
import type { ApiKey, License, LicenseStore, RateLimiter, RateWindow } from './licenses.js'
import { PUBLIC_VISIBILITY, type IndexedImage, type IndexStore, type Visibility } from './store.js'
import type { Meter, UsageMeter } from './usage.js'

/** Postgres implementations of the delivery stores, against db/migrations/0001_init.sql. */

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) })
}

/** SHA256 hex of an API key. Only this hash is stored (api_keys.key_hash). */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

export class PgIndexStore implements IndexStore {
  constructor(private pool: pg.Pool) {}

  async didForEmailHash(hash: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ did: string }>(
      `SELECT e.did FROM email_links e
         LEFT JOIN visibility_rules v ON v.did = e.did
        WHERE e.email_hash = $1 AND NOT coalesce(v.email_lookup_opt_out, false)`,
      [hash.toLowerCase()],
    )
    return rows[0]?.did ?? null
  }

  async serviceImages(did: string): Promise<IndexedImage[]> {
    const { rows } = await this.pool.query<{
      rkey: string; cid: string; mime_type: string; rating: string; is_default: boolean; created_at: Date
    }>(
      `SELECT rkey, cid, mime_type, rating, is_default, created_at
         FROM images WHERE did = $1 ORDER BY created_at DESC`,
      [did],
    )
    return rows.map((r) => ({
      rkey: r.rkey,
      cid: r.cid,
      mimeType: r.mime_type,
      // The column has a CHECK constraint; fall back to the strictest rating if it ever drifts.
      rating: isRating(r.rating) ? r.rating : 'x',
      isDefault: r.is_default,
      createdAt: r.created_at.toISOString(),
    }))
  }

  async visibility(did: string): Promise<Visibility> {
    const { rows } = await this.pool.query<{
      keyed_only: boolean; domain_allowlist: string[]; hidden_profile: boolean; email_lookup_opt_out: boolean
    }>(
      `SELECT keyed_only, domain_allowlist, hidden_profile, email_lookup_opt_out
         FROM visibility_rules WHERE did = $1`,
      [did],
    )
    const r = rows[0]
    if (!r) return PUBLIC_VISIBILITY
    return {
      keyedOnly: r.keyed_only,
      domainAllowlist: r.domain_allowlist,
      hiddenProfile: r.hidden_profile,
      emailLookupOptOut: r.email_lookup_opt_out,
    }
  }

  async isRepoActive(did: string): Promise<boolean> {
    // A repo the indexer has not seen yet (for example, a Bluesky-only user) counts as active.
    const { rows } = await this.pool.query<{ active: boolean }>('SELECT active FROM repos WHERE did = $1', [did])
    return rows[0]?.active ?? true
  }

  async isBlocked(did: string, cid: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('SELECT 1 FROM blocked_images WHERE did = $1 AND cid = $2', [did, cid])
    return (rowCount ?? 0) > 0
  }
}

export class PgLicenseStore implements LicenseStore {
  constructor(private pool: pg.Pool) {}

  async findKey(key: string): Promise<{ key: ApiKey; license: License } | null> {
    const { rows } = await this.pool.query<{
      kind: 'secret' | 'publishable'; domains: string[]; license_id: string; owner: string; tier: Tier; status: License['status']
    }>(
      `SELECT k.kind, k.domains, l.license_id, l.owner, l.tier, l.status
         FROM api_keys k JOIN licenses l ON l.license_id = k.license_id
        WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
      [hashApiKey(key)],
    )
    const r = rows[0]
    if (!r) return null
    return {
      key: { key, kind: r.kind, licenseId: r.license_id, domains: r.domains },
      license: { licenseId: r.license_id, owner: r.owner, tier: r.tier, status: r.status },
    }
  }
}

/** Fixed-window limiter in one atomic upsert per request. */
export class PgRateLimiter implements RateLimiter {
  constructor(private pool: pg.Pool) {}

  async hit(bucket: string, limit: number, windowSeconds: number): Promise<RateWindow> {
    const { rows } = await this.pool.query<{ count: number; reset: string }>(
      `INSERT INTO rate_windows AS w (bucket, count, reset_at)
            VALUES ($1, 1, now() + make_interval(secs => $2))
       ON CONFLICT (bucket) DO UPDATE SET
            count    = CASE WHEN w.reset_at <= now() THEN 1 ELSE w.count + 1 END,
            reset_at = CASE WHEN w.reset_at <= now() THEN now() + make_interval(secs => $2) ELSE w.reset_at END
       RETURNING count, floor(extract(epoch FROM reset_at))::bigint AS reset`,
      [bucket, windowSeconds],
    )
    const r = rows[0]!
    const count = Number(r.count)
    return { limit, remaining: Math.max(0, limit - count), reset: Number(r.reset), exceeded: count > limit }
  }
}

/** Counters roll over on the first day of each UTC month. */
export class PgUsageMeter implements UsageMeter {
  constructor(private pool: pg.Pool) {}

  async add(licenseId: string, meter: Meter, n = 1): Promise<void> {
    await this.pool.query(
      `INSERT INTO usage_counters (license_id, meter, period_start, count)
            VALUES ($1, $2, date_trunc('month', now() AT TIME ZONE 'UTC')::date, $3)
       ON CONFLICT (license_id, meter, period_start) DO UPDATE SET count = usage_counters.count + EXCLUDED.count`,
      [licenseId, meter, n],
    )
  }
}
