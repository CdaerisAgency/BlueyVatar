import type pg from 'pg'
import { decideLink, HOLD_DAYS, HOLD_MS, type LinkFacts } from './email-policy'
import type { Store } from './store'
import { inTx } from './tx'

type Q = Pick<pg.Pool, 'query'>

/** Serializes link changes per hash, then per account (always in that order, so no deadlock). */
const linkLocks = (emailHash: string, did: string): string[] => [`email:${emailHash}`, `did:${did}`]

async function pgFacts(c: Q, did: string, emailHash: string): Promise<LinkFacts> {
  const cur = await c.query('SELECT did FROM email_links WHERE email_hash = $1', [emailHash])
  const held = await c.query(
    `SELECT did, extract(epoch FROM released_at) * 1000 AS at FROM email_holds
      WHERE email_hash = $1 AND released_at > now() - make_interval(days => $2)`,
    [emailHash, HOLD_DAYS],
  )
  const n = await c.query('SELECT count(*)::int AS n FROM email_links WHERE did = $1', [did])
  const h = held.rows[0]
  return {
    owner: !cur.rows[0] ? 'none' : cur.rows[0].did === did ? 'self' : 'other',
    heldByOtherUntil: h && h.did !== did ? Number(h.at) + HOLD_MS : undefined,
    count: n.rows[0].n,
  }
}

/** Keeps notice_emails in step with the primary link: only the current primary's address survives. */
async function reconcilePg(c: Q, did: string, emailHash?: string, enc?: string): Promise<void> {
  if (emailHash) await c.query('DELETE FROM notice_emails WHERE email_hash = $1 AND did <> $2', [emailHash, did])
  await c.query(
    `DELETE FROM notice_emails WHERE did = $1
        AND email_hash NOT IN (SELECT email_hash FROM email_links WHERE did = $1 AND is_primary)`,
    [did],
  )
  if (emailHash && enc) {
    await c.query(
      `INSERT INTO notice_emails (did, email_hash, email_enc)
            SELECT did, email_hash, $3 FROM email_links WHERE did = $1 AND email_hash = $2 AND is_primary
       ON CONFLICT (did) DO UPDATE SET email_hash = EXCLUDED.email_hash, email_enc = EXCLUDED.email_enc, updated_at = now()`,
      [did, emailHash, enc],
    )
  }
}

async function promotePg(c: Q, did: string): Promise<void> {
  await c.query(
    `UPDATE email_links SET is_primary = true
      WHERE email_hash = (SELECT email_hash FROM email_links WHERE did = $1 ORDER BY verified_at, email_hash LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM email_links WHERE did = $1 AND is_primary)`,
    [did],
  )
}

/** The indexer runs the same statements when Tap reports an account as deleted (apps/indexer/src/pg-writes.ts). */
export async function releaseAllPg(c: Q, did: string): Promise<number> {
  await c.query(
    `INSERT INTO email_holds (email_hash, did, reason)
          SELECT email_hash, did, 'account_deleted' FROM email_links WHERE did = $1
     ON CONFLICT (email_hash) DO UPDATE SET did = EXCLUDED.did, released_at = now(), reason = EXCLUDED.reason`,
    [did],
  )
  const r = await c.query('DELETE FROM email_links WHERE did = $1', [did])
  await c.query('DELETE FROM email_codes WHERE did = $1', [did])
  await c.query('DELETE FROM notice_emails WHERE did = $1', [did])
  await c.query('DELETE FROM notification_prefs WHERE did = $1', [did])
  return r.rowCount ?? 0
}

export function pgLinks(pool: pg.Pool): Store['links'] {
  return {
    async list(did) {
      const r = await pool.query(
        'SELECT email_hash, method, verified_at, is_primary, email_domain, email_enc FROM email_links WHERE did = $1 ORDER BY is_primary DESC, verified_at, email_hash',
        [did],
      )
      return r.rows.map((x) => ({ emailHash: x.email_hash, method: x.method, verifiedAt: x.verified_at, primary: x.is_primary, emailDomain: x.email_domain ?? null, emailEnc: x.email_enc ?? null }))
    },
    async inspect(did, emailHash) {
      return pgFacts(pool, did, emailHash)
    },
    async noticeAddress(did) {
      const r = await pool.query('SELECT email_enc FROM notice_emails WHERE did = $1', [did])
      return r.rows[0]?.email_enc ?? undefined
    },
    async link(emailHash, did, method, emailMd5, emailEnc, emailDomain) {
      return inTx(
        pool,
        async (c) => {
          const f = await pgFacts(c, did, emailHash)
          const d = decideLink(f)
          if (!d.ok) return d
          if (f.owner === 'self') {
            await c.query(
              `UPDATE email_links SET method = $2, verified_at = now(), email_md5 = coalesce($3, email_md5), email_domain = coalesce($4, email_domain), email_enc = coalesce($5, email_enc) WHERE email_hash = $1`,
              [emailHash, method, emailMd5 ?? null, emailDomain ?? null, emailEnc ?? null],
            )
            await reconcilePg(c, did, emailHash, emailEnc)
            return d
          }
          if (f.owner === 'other') {
            const old = await c.query('DELETE FROM email_links WHERE email_hash = $1 RETURNING did, is_primary', [emailHash])
            if (old.rows[0]?.is_primary) await promotePg(c, old.rows[0].did)
            if (old.rows[0]) await reconcilePg(c, old.rows[0].did)
          }
          await c.query(
            'INSERT INTO email_links (email_hash, did, method, email_md5, is_primary, email_domain, email_enc) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [emailHash, did, method, emailMd5 ?? null, f.count === 0, emailDomain ?? null, emailEnc ?? null],
          )
          await c.query('DELETE FROM email_holds WHERE email_hash = $1', [emailHash])
          await reconcilePg(c, did, emailHash, emailEnc)
          return d
        },
        { lock: linkLocks(emailHash, did) },
      )
    },
    async remove(did, emailHash) {
      return inTx(
        pool,
        async (c) => {
          const r = await c.query('DELETE FROM email_links WHERE did = $1 AND email_hash = $2 RETURNING is_primary', [did, emailHash])
          if (!r.rows[0]) return false
          await c.query(
            `INSERT INTO email_holds (email_hash, did, reason) VALUES ($1, $2, 'unlinked')
             ON CONFLICT (email_hash) DO UPDATE SET did = EXCLUDED.did, released_at = now(), reason = EXCLUDED.reason`,
            [emailHash, did],
          )
          await c.query('DELETE FROM email_holds WHERE released_at < now() - make_interval(days => $1)', [HOLD_DAYS])
          if (r.rows[0].is_primary) await promotePg(c, did)
          await reconcilePg(c, did)
          return true
        },
        { lock: linkLocks(emailHash, did) },
      )
    },
    async setPrimary(did, emailHash) {
      return inTx(
        pool,
        async (c) => {
          const own = await c.query('SELECT 1 FROM email_links WHERE did = $1 AND email_hash = $2', [did, emailHash])
          if (!own.rows[0]) return false
          await c.query('UPDATE email_links SET is_primary = false WHERE did = $1 AND is_primary AND email_hash <> $2', [did, emailHash])
          await c.query('UPDATE email_links SET is_primary = true WHERE did = $1 AND email_hash = $2', [did, emailHash])
          await reconcilePg(c, did)
          return true
        },
        { lock: linkLocks(emailHash, did) },
      )
    },
    async releaseAll(did) {
      return inTx(pool, async (c) => releaseAllPg(c, did))
    },
  }
}
