import { randomBytes } from 'node:crypto'
import type pg from 'pg'
import { inTx } from './tx'

/** One signed-in browser or device. `device` is a coarse hint such as "Firefox on Linux". */
export type WebSession = { id: string; device: string; createdAt: Date; lastUsedAt: Date }

/** A session row counts as used again only when its last use is older than this, so reads stay cheap. */
export const SESSION_TOUCH_MS = 5 * 60 * 1000
const SESSION_KEEP_MS = 30 * 24 * 60 * 60 * 1000
const newSessionId = (): string => `s${randomBytes(16).toString('base64url')}`

/** Signed-in web sessions (migration 0023). The session cookie carries the id of one row. */
export interface WebSessions {
  create(did: string, device: string): Promise<string>
  /**
   * Whether a cookie is still good. A cookie with a session id needs its row; one without (issued before
   * sessions were tracked) is good unless the account signed out everywhere after `issuedAt`. A good check
   * also refreshes the row's last-used time, at most once per SESSION_TOUCH_MS.
   */
  valid(did: string, sid: string | null, issuedAt: number): Promise<boolean>
  /** Newest use first. */
  list(did: string): Promise<WebSession[]>
  /** False when the DID has no such session. */
  revoke(did: string, id: string): Promise<boolean>
  /** Deletes every session and invalidates older cookies. Returns how many rows were removed. */
  revokeAll(did: string): Promise<number>
}

export function memorySessions(clock: () => number): WebSessions {
  const webSessions = new Map<string, { did: string; device: string; createdAt: number; lastUsedAt: number }>()
  const floors = new Map<string, number>()
  return {
    async create(did, device) {
      const id = newSessionId()
      webSessions.set(id, { did, device, createdAt: clock(), lastUsedAt: clock() })
      return id
    },
    async valid(did, sid, issuedAt) {
      if (issuedAt <= (floors.get(did) ?? 0)) return false
      if (!sid) return true
      const row = webSessions.get(sid)
      if (!row || row.did !== did) return false
      if (clock() - row.lastUsedAt >= SESSION_TOUCH_MS) row.lastUsedAt = clock()
      return true
    },
    async list(did) {
      return [...webSessions]
        .filter(([, v]) => v.did === did)
        .map(([id, v]) => ({ id, device: v.device, createdAt: new Date(v.createdAt), lastUsedAt: new Date(v.lastUsedAt) }))
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
    },
    async revoke(did, id) {
      if (webSessions.get(id)?.did !== did) return false
      webSessions.delete(id)
      return true
    },
    async revokeAll(did) {
      let n = 0
      for (const [id, v] of [...webSessions]) if (v.did === did) (webSessions.delete(id), n++)
      floors.set(did, clock())
      return n
    },
  }
}

export function pgSessions(pool: pg.Pool): WebSessions {
  return {
    async create(did, device) {
      const id = newSessionId()
      await pool.query('INSERT INTO web_session (id, did, device) VALUES ($1, $2, $3)', [id, did, device])
      // Rows past the cookie lifetime can never be used again.
      await pool.query('DELETE FROM web_session WHERE did = $1 AND last_used_at < now() - ($2::bigint * interval \'1 millisecond\')', [did, SESSION_KEEP_MS])
      return id
    },
    async valid(did, sid, issuedAt) {
      const f = await pool.query('SELECT 1 FROM session_floor WHERE did = $1 AND revoked_at >= to_timestamp($2::double precision / 1000)', [did, issuedAt])
      if (f.rowCount) return false
      if (!sid) return true
      const r = await pool.query(
        `UPDATE web_session SET last_used_at = CASE WHEN last_used_at < now() - ($3::bigint * interval '1 millisecond') THEN now() ELSE last_used_at END
         WHERE id = $1 AND did = $2`,
        [sid, did, SESSION_TOUCH_MS],
      )
      return (r.rowCount ?? 0) > 0
    },
    async list(did) {
      const r = await pool.query('SELECT id, device, created_at, last_used_at FROM web_session WHERE did = $1 ORDER BY last_used_at DESC, id', [did])
      return r.rows.map((x) => ({ id: x.id, device: x.device, createdAt: x.created_at, lastUsedAt: x.last_used_at }))
    },
    async revoke(did, id) {
      const r = await pool.query('DELETE FROM web_session WHERE id = $1 AND did = $2', [id, did])
      return (r.rowCount ?? 0) > 0
    },
    async revokeAll(did) {
      return inTx(pool, async (c) => {
        await c.query('INSERT INTO session_floor (did, revoked_at) VALUES ($1, now()) ON CONFLICT (did) DO UPDATE SET revoked_at = now()', [did])
        const r = await c.query('DELETE FROM web_session WHERE did = $1', [did])
        return r.rowCount ?? 0
      })
    },
  }
}
