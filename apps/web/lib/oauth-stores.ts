import type { NodeSavedSession, NodeSavedSessionStore, NodeSavedState, NodeSavedStateStore } from '@atproto/oauth-client-node'
import type pg from 'pg'
import { decryptJson, encryptJson } from './token-crypto'

export type OauthStores = { oauthState: NodeSavedStateStore; oauthSession: NodeSavedSessionStore }

/** The same store with every key prefixed, so one flow's restore, refresh and signOut touch only its own entries. */
export function prefixedSessionStore(inner: NodeSavedSessionStore, prefix: string): NodeSavedSessionStore {
  return { get: (k) => inner.get(prefix + k), set: (k, v) => inner.set(prefix + k, v), del: (k) => inner.del(prefix + k) }
}

/** Sessions of the email-link flow live under this prefix, apart from the main sign-in session for the same DID. */
export const LINK_SESSION_PREFIX = 'link:'

export function memoryOauthStores(): OauthStores {
  const states = new Map<string, NodeSavedState>()
  const sessions = new Map<string, NodeSavedSession>()
  return {
    oauthState: { get: (k) => states.get(k), set: (k, v) => void states.set(k, v), del: (k) => void states.delete(k) },
    oauthSession: { get: (k) => sessions.get(k), set: (k, v) => void sessions.set(k, v), del: (k) => void sessions.delete(k) },
  }
}

export function pgOauthStores(pool: pg.Pool): OauthStores {
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
  }
}
