import type { NodeSavedSession, NodeSavedSessionStore, NodeSavedState, NodeSavedStateStore } from '@atproto/oauth-client-node'
import pg from 'pg'
import type { PendingCode } from './codes'
import { decideLink, HOLD_DAYS, HOLD_MS, type LinkDecision, type LinkFacts } from './email-policy'
import { decryptJson, encryptJson } from './token-crypto'

export type LinkMethod = 'trusted_pds' | 'code'
/** `emailDomain` is the domain of the linked address (never the address), or null for links made before migration 0016. */
export type LinkRow = { emailHash: string; method: LinkMethod; verifiedAt: Date; primary: boolean; emailDomain: string | null }

export interface Store {
  oauthState: NodeSavedStateStore
  oauthSession: NodeSavedSessionStore
  links: {
    /** Primary first, then oldest first. */
    list(did: string): Promise<LinkRow[]>
    /** What a link attempt would face right now. Used before mailing a code. */
    inspect(did: string, emailHash: string): Promise<LinkFacts>
    /**
     * Links the hash to the DID under the ownership policy (spec section 6): one hash, one DID; newest
     * verification wins and the old link is removed in the same transaction; cap of 10 per account;
     * a hash released by another DID is held for 30 days. The first email an account links becomes primary.
     * `emailDomain` (the part after the @, never the address) is stored on the row and refreshed when the owner verifies again.
     */
    link(emailHash: string, did: string, method: LinkMethod, emailMd5?: string, emailEnc?: string, emailDomain?: string): Promise<LinkDecision>
    /** The primary email encrypted at rest for notices, or undefined when none is stored (decrypt with token-crypto). */
    noticeAddress(did: string): Promise<string | undefined>
    /** Unlinks and starts the 30-day hold. Returns false when the DID did not own the hash. */
    remove(did: string, emailHash: string): Promise<boolean>
    /** Makes one of the account's emails primary. False when the DID does not own the hash. */
    setPrimary(did: string, emailHash: string): Promise<boolean>
    /** Account deleted: every link becomes a held hash, pending codes and the stored address are dropped. Returns how many. */
    releaseAll(did: string): Promise<number>
  }
  codes: {
    get(did: string): Promise<PendingCode | undefined>
    put(p: PendingCode): Promise<void>
    setAttempts(did: string, attempts: number): Promise<void>
    delete(did: string): Promise<void>
  }
}

export function memoryStore(clock: () => number = Date.now): Store {
  const states = new Map<string, NodeSavedState>()
  const sessions = new Map<string, NodeSavedSession>()
  type MemLink = { did: string; method: LinkMethod; verifiedAt: Date; emailMd5?: string; emailDomain?: string; primary: boolean }
  const links = new Map<string, MemLink>()
  const holds = new Map<string, { did: string; releasedAt: number }>()
  const notice = new Map<string, { emailHash: string; enc: string }>()
  /** Keeps the stored address in step with the primary link: only the current primary's address survives. */
  const reconcile = (did: string, emailHash?: string, enc?: string) => {
    const prim = ownedBy(did).find(([, v]) => v.primary)?.[0]
    if (emailHash) for (const [d, n] of [...notice]) if (n.emailHash === emailHash && d !== did) notice.delete(d)
    if (emailHash && enc && prim === emailHash) notice.set(did, { emailHash, enc })
    else if (notice.get(did)?.emailHash !== prim) notice.delete(did)
  }
  const ownedBy = (did: string) => [...links].filter(([, v]) => v.did === did)
  const promote = (did: string) => {
    if (ownedBy(did).some(([, v]) => v.primary)) return
    const next = ownedBy(did).sort((a, b) => a[1].verifiedAt.getTime() - b[1].verifiedAt.getTime())[0]
    if (next) next[1].primary = true
  }
  const hold = (emailHash: string, did: string) => holds.set(emailHash, { did, releasedAt: clock() })
  const facts = (did: string, emailHash: string): LinkFacts => {
    const cur = links.get(emailHash)
    const h = holds.get(emailHash)
    const until = h && h.did !== did && h.releasedAt + HOLD_MS > clock() ? h.releasedAt + HOLD_MS : undefined
    return { owner: !cur ? 'none' : cur.did === did ? 'self' : 'other', heldByOtherUntil: until, count: ownedBy(did).length }
  }
  const codes = new Map<string, PendingCode>()
  return {
    oauthState: { get: (k) => states.get(k), set: (k, v) => void states.set(k, v), del: (k) => void states.delete(k) },
    oauthSession: { get: (k) => sessions.get(k), set: (k, v) => void sessions.set(k, v), del: (k) => void sessions.delete(k) },
    links: {
      async list(did) {
        return ownedBy(did)
          .map(([emailHash, v]) => ({ emailHash, method: v.method, verifiedAt: v.verifiedAt, primary: v.primary, emailDomain: v.emailDomain ?? null }))
          .sort((a, b) => Number(b.primary) - Number(a.primary) || a.verifiedAt.getTime() - b.verifiedAt.getTime())
      },
      async inspect(did, emailHash) {
        return facts(did, emailHash)
      },
      async link(emailHash, did, method, emailMd5, emailEnc, emailDomain) {
        const f = facts(did, emailHash)
        const d = decideLink(f)
        if (!d.ok) return d
        if (f.owner === 'self') {
          const cur = links.get(emailHash)!
          links.set(emailHash, { ...cur, method, verifiedAt: new Date(clock()), emailMd5: emailMd5 ?? cur.emailMd5, emailDomain: emailDomain ?? cur.emailDomain })
          reconcile(did, emailHash, emailEnc)
          return d
        }
        const prev = links.get(emailHash)
        links.delete(emailHash)
        if (prev) promote(prev.did)
        links.set(emailHash, { did, method, verifiedAt: new Date(clock()), emailMd5, emailDomain, primary: f.count === 0 })
        holds.delete(emailHash)
        if (prev) reconcile(prev.did)
        reconcile(did, emailHash, emailEnc)
        return d
      },
      async noticeAddress(did) {
        return notice.get(did)?.enc
      },
      async remove(did, emailHash) {
        if (links.get(emailHash)?.did !== did) return false
        links.delete(emailHash)
        hold(emailHash, did)
        promote(did)
        reconcile(did)
        return true
      },
      async setPrimary(did, emailHash) {
        if (links.get(emailHash)?.did !== did) return false
        for (const [, v] of ownedBy(did)) v.primary = false
        links.get(emailHash)!.primary = true
        reconcile(did)
        return true
      },
      async releaseAll(did) {
        const mine = ownedBy(did)
        for (const [h] of mine) {
          links.delete(h)
          hold(h, did)
        }
        codes.delete(did)
        notice.delete(did)
        return mine.length
      },
    },
    codes: {
      async get(did) {
        return codes.get(did)
      },
      async put(p) {
        codes.set(p.did, p)
      },
      async setAttempts(did, attempts) {
        const p = codes.get(did)
        if (p) codes.set(did, { ...p, attempts })
      },
      async delete(did) {
        codes.delete(did)
      },
    },
  }
}

type Q = Pick<pg.Pool, 'query'>

async function inTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    c.release()
  }
}

/** Serializes link changes per hash, then per account (always in that order, so no deadlock). */
async function lockFor(c: Q, emailHash: string, did: string): Promise<void> {
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`email:${emailHash}`])
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`did:${did}`])
}

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
  return r.rowCount ?? 0
}

export function pgStore(pool: pg.Pool): Store {
  return {
    oauthState: {
      async get(key) {
        const r = await pool.query('SELECT value FROM oauth_state WHERE key = $1', [key])
        return r.rows[0] ? decryptJson<NodeSavedState>(r.rows[0].value) : undefined
      },
      async set(key, value) {
        await pool.query(
          'INSERT INTO oauth_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
          [key, encryptJson(value)],
        )
        // Pending requests older than an hour are abandoned.
        await pool.query("DELETE FROM oauth_state WHERE created_at < now() - interval '1 hour'")
      },
      async del(key) {
        await pool.query('DELETE FROM oauth_state WHERE key = $1', [key])
      },
    },
    oauthSession: {
      async get(sub) {
        const r = await pool.query('SELECT value FROM oauth_session WHERE sub = $1', [sub])
        return r.rows[0] ? decryptJson<NodeSavedSession>(r.rows[0].value) : undefined
      },
      async set(sub, value) {
        await pool.query(
          'INSERT INTO oauth_session (sub, value) VALUES ($1, $2) ON CONFLICT (sub) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
          [sub, encryptJson(value)],
        )
      },
      async del(sub) {
        await pool.query('DELETE FROM oauth_session WHERE sub = $1', [sub])
      },
    },
    links: {
      async list(did) {
        const r = await pool.query(
          'SELECT email_hash, method, verified_at, is_primary, email_domain FROM email_links WHERE did = $1 ORDER BY is_primary DESC, verified_at, email_hash',
          [did],
        )
        return r.rows.map((x) => ({ emailHash: x.email_hash, method: x.method, verifiedAt: x.verified_at, primary: x.is_primary, emailDomain: x.email_domain ?? null }))
      },
      async inspect(did, emailHash) {
        return pgFacts(pool, did, emailHash)
      },
      async noticeAddress(did) {
        const r = await pool.query('SELECT email_enc FROM notice_emails WHERE did = $1', [did])
        return r.rows[0]?.email_enc ?? undefined
      },
      async link(emailHash, did, method, emailMd5, emailEnc, emailDomain) {
        return inTx(pool, async (c) => {
          await lockFor(c, emailHash, did)
          const f = await pgFacts(c, did, emailHash)
          const d = decideLink(f)
          if (!d.ok) return d
          if (f.owner === 'self') {
            await c.query(
              `UPDATE email_links SET method = $2, verified_at = now(), email_md5 = coalesce($3, email_md5), email_domain = coalesce($4, email_domain) WHERE email_hash = $1`,
              [emailHash, method, emailMd5 ?? null, emailDomain ?? null],
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
            'INSERT INTO email_links (email_hash, did, method, email_md5, is_primary, email_domain) VALUES ($1, $2, $3, $4, $5, $6)',
            [emailHash, did, method, emailMd5 ?? null, f.count === 0, emailDomain ?? null],
          )
          await c.query('DELETE FROM email_holds WHERE email_hash = $1', [emailHash])
          await reconcilePg(c, did, emailHash, emailEnc)
          return d
        })
      },
      async remove(did, emailHash) {
        return inTx(pool, async (c) => {
          await lockFor(c, emailHash, did)
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
        })
      },
      async setPrimary(did, emailHash) {
        return inTx(pool, async (c) => {
          await lockFor(c, emailHash, did)
          const own = await c.query('SELECT 1 FROM email_links WHERE did = $1 AND email_hash = $2', [did, emailHash])
          if (!own.rows[0]) return false
          await c.query('UPDATE email_links SET is_primary = false WHERE did = $1 AND is_primary AND email_hash <> $2', [did, emailHash])
          await c.query('UPDATE email_links SET is_primary = true WHERE did = $1 AND email_hash = $2', [did, emailHash])
          await reconcilePg(c, did)
          return true
        })
      },
      async releaseAll(did) {
        return inTx(pool, async (c) => releaseAllPg(c, did))
      },
    },
    codes: {
      async get(did) {
        const r = await pool.query('SELECT * FROM email_codes WHERE did = $1', [did])
        const x = r.rows[0]
        if (!x) return undefined
        return {
          did: x.did,
          emailHash: x.email_hash,
          emailMd5: x.email_md5 ?? undefined,
          emailEnc: x.email_enc ?? undefined,
          emailDomain: x.email_domain ?? undefined,
          codeHash: x.code_hash,
          masked: x.masked,
          attempts: x.attempts,
          expiresAt: new Date(x.expires_at).getTime(),
          createdAt: new Date(x.created_at).getTime(),
        }
      },
      async put(p) {
        await pool.query(
          `INSERT INTO email_codes (did, email_hash, email_md5, code_hash, masked, attempts, expires_at, created_at, email_enc, email_domain)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)
           ON CONFLICT (did) DO UPDATE SET email_hash = EXCLUDED.email_hash, email_md5 = EXCLUDED.email_md5,
             code_hash = EXCLUDED.code_hash, masked = EXCLUDED.masked, attempts = 0,
             expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at, email_enc = EXCLUDED.email_enc,
             email_domain = EXCLUDED.email_domain`,
          [p.did, p.emailHash, p.emailMd5 ?? null, p.codeHash, p.masked, new Date(p.expiresAt), new Date(p.createdAt), p.emailEnc ?? null, p.emailDomain ?? null],
        )
        // An unconfirmed code (and the encrypted address it carries) never outlives its 15 minutes by much.
        await pool.query('DELETE FROM email_codes WHERE expires_at < now() - interval \'1 hour\'')
      },
      async setAttempts(did, attempts) {
        await pool.query('UPDATE email_codes SET attempts = $2 WHERE did = $1', [did, attempts])
      },
      async delete(did) {
        await pool.query('DELETE FROM email_codes WHERE did = $1', [did])
      },
    },
  }
}

const g = globalThis as { __bvStore?: Store; __bvPool?: pg.Pool }

/** The shared Postgres pool, or null when DATABASE_URL is unset (in-memory dev mode). */
export function getPool(): pg.Pool | null {
  if (!process.env.DATABASE_URL) return null
  g.__bvPool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 5 })
  return g.__bvPool
}

/** Postgres when DATABASE_URL is set, otherwise in-memory (dev only, lost on restart). */
export function getStore(): Store {
  const pool = getPool()
  g.__bvStore ??= pool ? pgStore(pool) : memoryStore()
  return g.__bvStore
}
