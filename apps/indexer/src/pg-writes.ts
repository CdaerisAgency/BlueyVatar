import pg from 'pg'
import type { IndexWrites } from './handlers.js'

export interface PgWritesOptions {
  /**
   * Called after an avatar change. Image URLs are keyed by blob CID, so a new
   * avatar gets a new URL and the uncached redirect picks it up. This hook is
   * for CDN purges or cache warming (spec sections 4 and 9).
   */
  onPurge?: (did: string, cids: string[]) => Promise<void>
  /** Warms one blob through the CDN. Used after a purge when the caller asks. Best-effort. */
  onWarm?: (did: string, cid: string) => Promise<void>
  /** Called after an image upsert, for cache warming. Best-effort: not awaited, errors are logged. */
  onImageUpserted?: (did: string, cid: string) => Promise<void>
}

/** Postgres implementation of IndexWrites against db/migrations/0001_init.sql. */
export class PgIndexWrites implements IndexWrites {
  constructor(private pool: pg.Pool, private opts: PgWritesOptions = {}) {}

  async upsertImage(r: Parameters<IndexWrites['upsertImage']>[0]): Promise<void> {
    await this.pool.query(
      `INSERT INTO images (did, rkey, cid, mime_type, rating, is_default, license, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (did, rkey) DO UPDATE SET
            cid = EXCLUDED.cid, mime_type = EXCLUDED.mime_type, rating = EXCLUDED.rating,
            is_default = EXCLUDED.is_default, license = EXCLUDED.license,
            created_at = EXCLUDED.created_at, indexed_at = now()`,
      [r.did, r.rkey, r.cid, r.mimeType, r.rating, r.isDefault, r.license, r.createdAt],
    )
    this.opts.onImageUpserted?.(r.did, r.cid).catch((err) => console.warn('image upsert hook failed', err))
  }

  async deleteImage(did: string, rkey: string): Promise<string | undefined> {
    const res = await this.pool.query<{ cid: string }>('DELETE FROM images WHERE did = $1 AND rkey = $2 RETURNING cid', [did, rkey])
    return res.rows[0]?.cid
  }

  async upsertProfile(did: string, record: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `INSERT INTO profiles (did, record) VALUES ($1, $2)
       ON CONFLICT (did) DO UPDATE SET record = EXCLUDED.record, indexed_at = now()`,
      [did, JSON.stringify(record)],
    )
  }

  async deleteProfile(did: string): Promise<void> {
    await this.pool.query('DELETE FROM profiles WHERE did = $1', [did])
  }

  async upsertClaim(did: string, rkey: string, record: Record<string, unknown>): Promise<void> {
    const platform = typeof record.platform === 'string' ? record.platform : null
    const uri = typeof record.uri === 'string' ? record.uri : null
    await this.pool.query(
      `INSERT INTO claims (did, rkey, platform, uri, record) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (did, rkey) DO UPDATE SET
            platform = EXCLUDED.platform, uri = EXCLUDED.uri, record = EXCLUDED.record, indexed_at = now()`,
      [did, rkey, platform, uri, JSON.stringify(record)],
    )
  }

  async deleteClaim(did: string, rkey: string): Promise<void> {
    await this.pool.query('DELETE FROM claims WHERE did = $1 AND rkey = $2', [did, rkey])
  }

  async upsertProfileLink(r: Parameters<IndexWrites['upsertProfileLink']>[0]): Promise<void> {
    await this.pool.query(
      `INSERT INTO profile_links (did, rkey, cid, url, title, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (did, rkey) DO UPDATE SET
            cid = EXCLUDED.cid, url = EXCLUDED.url, title = EXCLUDED.title,
            created_at = EXCLUDED.created_at, indexed_at = now()`,
      [r.did, r.rkey, r.cid, r.url, r.title, r.createdAt],
    )
  }

  async deleteProfileLink(did: string, rkey: string): Promise<void> {
    await this.pool.query('DELETE FROM profile_links WHERE did = $1 AND rkey = $2', [did, rkey])
  }

  async setRepoStatus(did: string, handle: string | null, active: boolean, status?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO repos (did, handle, active, status) VALUES ($1, $2, $3, $4)
       ON CONFLICT (did) DO UPDATE SET
            handle = EXCLUDED.handle, active = EXCLUDED.active, status = EXCLUDED.status, updated_at = now()`,
      [did, handle, active, status ?? (active ? 'active' : null)],
    )
    if (status === 'deleted') await this.releaseEmails(did)
    if (!active) await this.purgeImages(did)
  }

  /** Account deleted: its email links become 30-day holds so no other DID can claim them at once (spec section 6). */
  private async releaseEmails(did: string): Promise<void> {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query(
        `INSERT INTO email_holds (email_hash, did, reason)
              SELECT email_hash, did, 'account_deleted' FROM email_links WHERE did = $1
         ON CONFLICT (email_hash) DO UPDATE SET did = EXCLUDED.did, released_at = now(), reason = EXCLUDED.reason`,
        [did],
      )
      await c.query('DELETE FROM email_links WHERE did = $1', [did])
      await c.query('DELETE FROM email_codes WHERE did = $1', [did])
      await c.query('DELETE FROM notice_emails WHERE did = $1', [did])
      await c.query('COMMIT')
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      c.release()
    }
  }

  async purgeImages(did: string, cids?: string[], opts: { warm?: boolean } = {}): Promise<void> {
    if (!this.opts.onPurge && !(opts.warm && this.opts.onWarm)) return
    const list = cids ?? (await this.pool.query<{ cid: string }>('SELECT DISTINCT cid FROM images WHERE did = $1', [did])).rows.map((r) => r.cid)
    if (!list.length) return
    await this.opts.onPurge?.(did, list)
    // Re-warm after the purge so the first visitor does not pay for the miss. Fire and forget.
    const warm = this.opts.onWarm
    if (opts.warm && warm) for (const cid of list) warm(did, cid).catch((err) => console.warn('post-purge warm failed', err))
  }
}
