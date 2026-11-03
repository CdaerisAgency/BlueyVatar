import type { NodeSavedSession, NodeSavedSessionStore, NodeSavedState, NodeSavedStateStore } from '@atproto/oauth-client-node'
import pg from 'pg'
import type { PendingCode } from './codes'

export type LinkMethod = 'trusted_pds' | 'code'
export type LinkRow = { emailHash: string; method: LinkMethod; verifiedAt: Date }

export interface Store {
  oauthState: NodeSavedStateStore
  oauthSession: NodeSavedSessionStore
  links: {
    list(did: string): Promise<LinkRow[]>
    /** Two DIDs claiming one hash: the newest verification wins (spec section 13, item 5). */
    upsert(emailHash: string, did: string, method: LinkMethod): Promise<void>
    remove(did: string, emailHash: string): Promise<void>
  }
  codes: {
    get(did: string): Promise<PendingCode | undefined>
    put(p: PendingCode): Promise<void>
    setAttempts(did: string, attempts: number): Promise<void>
    delete(did: string): Promise<void>
  }
}

function memoryStore(): Store {
  const states = new Map<string, NodeSavedState>()
  const sessions = new Map<string, NodeSavedSession>()
  const links = new Map<string, { did: string; method: LinkMethod; verifiedAt: Date }>()
  const codes = new Map<string, PendingCode>()
  return {
    oauthState: { get: (k) => states.get(k), set: (k, v) => void states.set(k, v), del: (k) => void states.delete(k) },
    oauthSession: { get: (k) => sessions.get(k), set: (k, v) => void sessions.set(k, v), del: (k) => void sessions.delete(k) },
    links: {
      async list(did) {
        return [...links].filter(([, v]) => v.did === did).map(([emailHash, v]) => ({ emailHash, method: v.method, verifiedAt: v.verifiedAt }))
      },
      async upsert(emailHash, did, method) {
        links.set(emailHash, { did, method, verifiedAt: new Date() })
      },
      async remove(did, emailHash) {
        if (links.get(emailHash)?.did === did) links.delete(emailHash)
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

function pgStore(pool: pg.Pool): Store {
  return {
    oauthState: {
      async get(key) {
        const r = await pool.query('SELECT value FROM oauth_state WHERE key = $1', [key])
        return r.rows[0]?.value as NodeSavedState | undefined
      },
      async set(key, value) {
        await pool.query(
          'INSERT INTO oauth_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
          [key, JSON.stringify(value)],
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
        return r.rows[0]?.value as NodeSavedSession | undefined
      },
      async set(sub, value) {
        await pool.query(
          'INSERT INTO oauth_session (sub, value) VALUES ($1, $2) ON CONFLICT (sub) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
          [sub, JSON.stringify(value)],
        )
      },
      async del(sub) {
        await pool.query('DELETE FROM oauth_session WHERE sub = $1', [sub])
      },
    },
    links: {
      async list(did) {
        const r = await pool.query('SELECT email_hash, method, verified_at FROM email_links WHERE did = $1 ORDER BY verified_at', [did])
        return r.rows.map((x) => ({ emailHash: x.email_hash, method: x.method, verifiedAt: x.verified_at }))
      },
      async upsert(emailHash, did, method) {
        await pool.query(
          `INSERT INTO email_links (email_hash, did, method) VALUES ($1, $2, $3)
           ON CONFLICT (email_hash) DO UPDATE SET did = EXCLUDED.did, method = EXCLUDED.method, verified_at = now()`,
          [emailHash, did, method],
        )
      },
      async remove(did, emailHash) {
        await pool.query('DELETE FROM email_links WHERE did = $1 AND email_hash = $2', [did, emailHash])
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
          codeHash: x.code_hash,
          masked: x.masked,
          attempts: x.attempts,
          expiresAt: new Date(x.expires_at).getTime(),
          createdAt: new Date(x.created_at).getTime(),
        }
      },
      async put(p) {
        await pool.query(
          `INSERT INTO email_codes (did, email_hash, code_hash, masked, attempts, expires_at, created_at)
           VALUES ($1, $2, $3, $4, 0, $5, $6)
           ON CONFLICT (did) DO UPDATE SET email_hash = EXCLUDED.email_hash, code_hash = EXCLUDED.code_hash,
             masked = EXCLUDED.masked, attempts = 0, expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at`,
          [p.did, p.emailHash, p.codeHash, p.masked, new Date(p.expiresAt), new Date(p.createdAt)],
        )
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

const g = globalThis as { __bvStore?: Store }

/** Postgres when DATABASE_URL is set, otherwise in-memory (dev only, lost on restart). */
export function getStore(): Store {
  g.__bvStore ??= process.env.DATABASE_URL
    ? pgStore(new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 5 }))
    : memoryStore()
  return g.__bvStore
}
