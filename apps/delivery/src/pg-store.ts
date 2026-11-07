import { createHash } from 'node:crypto'
import { DAILY_METERS, effectiveTier, isRating, parseCrop, plusEntitled, type CropParams, type IndexedLinkRecord, type SubscriptionStatus, type Tier } from '@blueyvatar/core'
import pg from 'pg'
import type { ApiKey, License, LicenseStore, RateLimiter, RateWindow } from './licenses.js'
import { PUBLIC_VISIBILITY, type IndexedImage, type IndexStore, type VerifiedAccount, type Visibility } from './store.js'
import type { AlertLedger, AlertThreshold } from './alerts.js'
import type { Meter, ServiceMeter, UsageMeter, UsageSnapshot } from './usage.js'

/** Postgres implementations of the delivery stores, against db/migrations/0001_init.sql. */

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) })
}

/** SHA256 hex of an API key. Only this hash is stored (api_keys.key_hash). */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

/** The crop columns are written together (migration 0029). Anything that does not parse means the center crop. */
const rowCrop = (r: { crop_x: number | null; crop_y: number | null; crop_size: number | null }): CropParams | null =>
  parseCrop({ x: r.crop_x, y: r.crop_y, size: r.crop_size })

export class PgIndexStore implements IndexStore {
  constructor(private pool: pg.Pool) {}

  async didForEmailHash(hash: string): Promise<string | null> {
    // Only links created or re-verified after migration 0006 carry an MD5. It cannot be derived
    // from the stored SHA256 and raw emails are never kept, so older links answer to SHA256 only
    // until their owner verifies the email again.
    const column = hash.length === 32 ? 'email_md5' : 'email_hash'
    const { rows } = await this.pool.query<{ did: string }>(
      `SELECT e.did FROM email_links e
         LEFT JOIN visibility_rules v ON v.did = e.did
        WHERE e.${column} = $1 AND NOT coalesce(v.email_lookup_opt_out, false)`,
      [hash.toLowerCase()],
    )
    return rows[0]?.did ?? null
  }

  async serviceImages(did: string): Promise<IndexedImage[]> {
    return this.images(did, `purpose = 'avatar'`, 'created_at DESC')
  }

  async galleryImages(did: string): Promise<IndexedImage[]> {
    return this.images(did, `purpose = 'gallery'`, 'sort ASC NULLS LAST, created_at DESC')
  }

  private async images(did: string, where: string, order: string): Promise<IndexedImage[]> {
    const { rows } = await this.pool.query<{
      rkey: string; cid: string; mime_type: string; rating: string; is_default: boolean; purpose: string
      caption: string | null; sort: number | null; created_at: Date
      crop_x: number | null; crop_y: number | null; crop_size: number | null
    }>(
      `SELECT rkey, cid, mime_type, rating, is_default, purpose, caption, sort, created_at, crop_x, crop_y, crop_size
         FROM images WHERE did = $1 AND ${where} ORDER BY ${order}`,
      [did],
    )
    return rows.map((r) => ({
      rkey: r.rkey,
      cid: r.cid,
      mimeType: r.mime_type,
      // The column has a CHECK constraint; fall back to the strictest rating if it ever drifts.
      rating: isRating(r.rating) ? r.rating : 'x',
      isDefault: r.is_default,
      purpose: r.purpose,
      caption: r.caption,
      sort: r.sort,
      crop: rowCrop(r),
      createdAt: r.created_at.toISOString(),
    }))
  }

  async imageCrop(did: string, cid: string): Promise<CropParams | null> {
    const { rows } = await this.pool.query<{ crop_x: number | null; crop_y: number | null; crop_size: number | null }>(
      'SELECT crop_x, crop_y, crop_size FROM images WHERE did = $1 AND cid = $2 AND crop_size IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [did, cid],
    )
    return rows[0] ? rowCrop(rows[0]) : null
  }

  async profileLinks(did: string): Promise<IndexedLinkRecord[]> {
    const { rows } = await this.pool.query<IndexedLinkRecord>('SELECT rkey, cid, url, title FROM profile_links WHERE did = $1', [did])
    return rows
  }

  async hasPlusSubscription(did: string, now: Date): Promise<boolean> {
    const { rows } = await this.pool.query<{ status: SubscriptionStatus; past_due_since: Date | null }>(
      `SELECT status, past_due_since FROM subscriptions WHERE did = $1 AND tier = 'plus' AND status IN ('active', 'trialing', 'past_due')`,
      [did],
    )
    return plusEntitled(rows.map((r) => ({ tier: 'plus', status: r.status, pastDueSince: r.past_due_since })), now)
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
    const { rowCount } = await this.pool.query('SELECT 1 FROM blocked_images WHERE did = $1 AND cid = $2 AND unblocked_at IS NULL', [did, cid])
    return (rowCount ?? 0) > 0
  }

  async verifiedAccounts(did: string): Promise<VerifiedAccount[]> {
    // Latest attestation per claim. It counts only while it is verified and was issued for the
    // claim's current uri (claim_uri is null for rows written before migration 0004).
    const { rows } = await this.pool.query<{ platform: string; uri: string; verified_at: Date; hidden: boolean }>(
      `SELECT c.platform, c.uri, a.created_at AS verified_at, coalesce((c.record->>'hidden')::boolean, false) AS hidden
         FROM claims c
         JOIN LATERAL (
           SELECT result, claim_uri, created_at FROM attestations
            WHERE claim_did = c.did AND claim_rkey = c.rkey
            ORDER BY created_at DESC LIMIT 1
         ) a ON true
        WHERE c.did = $1 AND a.result = 'verified'
          AND (a.claim_uri IS NULL OR a.claim_uri = c.uri)
          AND c.platform IS NOT NULL AND c.uri IS NOT NULL
        ORDER BY a.created_at, c.rkey`,
      [did],
    )
    return rows.map((r) => ({ platform: r.platform, uri: r.uri, verifiedAt: r.verified_at.toISOString(), hidden: r.hidden }))
  }
}

export class PgLicenseStore implements LicenseStore {
  constructor(private pool: pg.Pool) {}

  async findKey(key: string): Promise<{ key: ApiKey; license: License } | null> {
    const { rows } = await this.pool.query<{
      kind: 'secret' | 'publishable'; domains: string[]; license_id: string; owner: string; tier: Tier; status: License['status']; grace_ends_at: Date | null
    }>(
      `SELECT k.kind, k.domains, l.license_id, l.owner, l.tier, l.status, l.grace_ends_at
         FROM api_keys k JOIN licenses l ON l.license_id = k.license_id
        WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
      [hashApiKey(key)],
    )
    const r = rows[0]
    if (!r) return null
    return {
      key: { key, kind: r.kind, licenseId: r.license_id, domains: r.domains },
      // Past due keeps the paid tier through the grace period, then reads as Free (spec section 12). No webhook is needed to expire it.
      license: { licenseId: r.license_id, owner: r.owner, tier: effectiveTier({ tier: r.tier, status: r.status, graceEndsAt: r.grace_ends_at }, new Date()), status: r.status },
    }
  }
}

/** Fixed-window limiter in one atomic upsert per request. */
export class PgRateLimiter implements RateLimiter {
  constructor(private pool: pg.Pool) {}

  async hit(bucket: string, limit: number, windowSeconds: number, n = 1): Promise<RateWindow> {
    const { rows } = await this.pool.query<{ count: number; reset: string }>(
      `INSERT INTO rate_windows AS w (bucket, count, reset_at)
            VALUES ($1, $3::int, now() + make_interval(secs => $2))
       ON CONFLICT (bucket) DO UPDATE SET
            count    = CASE WHEN w.reset_at <= now() THEN $3::int ELSE w.count + $3::int END,
            reset_at = CASE WHEN w.reset_at <= now() THEN now() + make_interval(secs => $2) ELSE w.reset_at END
       RETURNING count, floor(extract(epoch FROM reset_at))::bigint AS reset`,
      [bucket, windowSeconds, n],
    )
    const r = rows[0]!
    const count = Number(r.count)
    return { limit, remaining: Math.max(0, limit - count), reset: Number(r.reset), exceeded: count > limit }
  }
}

/** Counters roll over on the first day of each UTC month. */
export class PgUsageMeter implements UsageMeter {
  constructor(private pool: pg.Pool) {}

  async add(licenseId: string, meter: Meter, n = 1): Promise<number> {
    // Day rows ride in the same statement as the monthly counter, so the two never disagree on the
    // UTC date. Billing and alerts read only the monthly counter.
    const daily = (DAILY_METERS as readonly string[]).includes(meter)
      ? `WITH day AS (
           INSERT INTO usage_daily (license_id, meter, day, count)
                VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date, $3)
           ON CONFLICT (license_id, meter, day) DO UPDATE SET count = usage_daily.count + EXCLUDED.count
         ) `
      : ''
    const { rows } = await this.pool.query<{ count: string }>(
      `${daily}INSERT INTO usage_counters (license_id, meter, period_start, count)
            VALUES ($1, $2, date_trunc('month', now() AT TIME ZONE 'UTC')::date, $3)
       ON CONFLICT (license_id, meter, period_start) DO UPDATE SET count = usage_counters.count + EXCLUDED.count
       RETURNING count`,
      [licenseId, meter, n],
    )
    return Number(rows[0]!.count)
  }

  async read(licenseId: string, periods: readonly string[], days: readonly string[]): Promise<UsageSnapshot> {
    const monthly = new Map<string, number>()
    const daily = new Map<string, number>()
    if (periods.length > 0) {
      const r = await this.pool.query(
        'SELECT meter, period_start::text AS period, count FROM usage_counters WHERE license_id = $1 AND period_start = ANY($2::date[])',
        [licenseId, periods],
      )
      for (const x of r.rows) monthly.set(`${x.period}|${x.meter}`, Number(x.count))
    }
    if (days.length > 0) {
      const r = await this.pool.query(
        'SELECT meter, day::text AS day, count FROM usage_daily WHERE license_id = $1 AND day = ANY($2::date[])',
        [licenseId, days],
      )
      for (const x of r.rows) daily.set(`${x.day}|${x.meter}`, Number(x.count))
    }
    return { monthly, daily }
  }

  async addProfileCall(did: string, n = 1): Promise<void> {
    await this.pool.query(
      `INSERT INTO profile_view_counters (did, day, json_calls)
            VALUES ($1, (now() AT TIME ZONE 'UTC')::date, $2)
       ON CONFLICT (did, day) DO UPDATE SET json_calls = profile_view_counters.json_calls + EXCLUDED.json_calls`,
      [did, n],
    )
  }

  async addService(did: string, meter: ServiceMeter, n = 1): Promise<void> {
    await this.pool.query(
      `INSERT INTO service_usage_counters (did, meter, period_start, count)
            VALUES ($1, $2, date_trunc('month', now() AT TIME ZONE 'UTC')::date, $3)
       ON CONFLICT (did, meter, period_start) DO UPDATE SET count = service_usage_counters.count + EXCLUDED.count`,
      [did, meter, n],
    )
  }
}

/** Against db/migrations/0003_usage_alerts.sql. */
export class PgAlertLedger implements AlertLedger {
  constructor(private pool: pg.Pool) {}

  async claim(licenseId: string, period: string, threshold: AlertThreshold): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO usage_alerts (license_id, period_start, threshold) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [licenseId, period, threshold],
    )
    return (rowCount ?? 0) > 0
  }
}

/** The owner DID of a license, for addressing usage alerts. */
export function pgLicenseOwner(pool: pg.Pool) {
  return async (licenseId: string): Promise<string | null> =>
    (await pool.query('SELECT owner FROM licenses WHERE license_id = $1', [licenseId])).rows[0]?.owner ?? null
}
