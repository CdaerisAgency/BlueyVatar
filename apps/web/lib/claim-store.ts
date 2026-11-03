import type { ClaimRecord } from './claims'
import type { MastodonApp } from './mastodon-oauth'
import { getPool } from './store'

export type AttestationRow = {
  uri: string
  cid: string
  claimDid: string
  claimRkey: string
  claimCid: string
  claimUri: string
  result: 'verified' | 'failed' | 'revoked'
  method: string
  createdAt: Date
}

export type PendingVerification = { state: string; did: string; rkey: string; provider: 'github' | 'mastodon'; instance?: string }

const STATE_TTL_MS = 15 * 60_000

export interface ClaimStore {
  /** Mirrors a claim record into the claims table so delivery can read it before the indexer does. */
  upsertClaim(did: string, rkey: string, record: ClaimRecord): Promise<void>
  deleteClaim(did: string, rkey: string): Promise<void>
  /** Latest attestation per claim for the DID. */
  latestAttestations(did: string): Promise<AttestationRow[]>
  /** Stores a verified attestation. Earlier verified rows for the claim become revoked; their uris are returned. */
  recordVerified(row: AttestationRow): Promise<string[]>
  /** Marks every attestation for the claim revoked and returns the uris to delete from the service repo. */
  revokeForClaim(did: string, rkey: string): Promise<string[]>
  mastodonApp(instance: string): Promise<MastodonApp | null>
  putMastodonApp(app: MastodonApp): Promise<void>
  putState(p: PendingVerification): Promise<void>
  /** Returns and deletes a pending verification. Null when unknown or older than 15 minutes. */
  takeState(state: string): Promise<PendingVerification | null>
}

export function memoryClaimStore(): ClaimStore & { claims: Map<string, ClaimRecord>; attestations: AttestationRow[] } {
  const claims = new Map<string, ClaimRecord>()
  const attestations: AttestationRow[] = []
  const apps = new Map<string, MastodonApp>()
  const states = new Map<string, PendingVerification & { at: number }>()
  const key = (did: string, rkey: string) => `${did}/${rkey}`
  return {
    claims,
    attestations,
    async upsertClaim(did, rkey, record) {
      claims.set(key(did, rkey), record)
    },
    async deleteClaim(did, rkey) {
      claims.delete(key(did, rkey))
    },
    async latestAttestations(did) {
      const latest = new Map<string, AttestationRow>()
      for (const a of [...attestations].filter((x) => x.claimDid === did).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) latest.set(a.claimRkey, a)
      return [...latest.values()]
    },
    async recordVerified(row) {
      const old = attestations.filter((a) => a.claimDid === row.claimDid && a.claimRkey === row.claimRkey && a.result === 'verified')
      for (const a of old) a.result = 'revoked'
      attestations.push(row)
      return old.map((a) => a.uri)
    },
    async revokeForClaim(did, rkey) {
      const hit = attestations.filter((a) => a.claimDid === did && a.claimRkey === rkey && a.result !== 'revoked')
      for (const a of hit) a.result = 'revoked'
      return hit.map((a) => a.uri)
    },
    async mastodonApp(instance) {
      return apps.get(instance) ?? null
    },
    async putMastodonApp(app) {
      apps.set(app.instance, app)
    },
    async putState(p) {
      states.set(p.state, { ...p, at: Date.now() })
    },
    async takeState(state) {
      const s = states.get(state)
      states.delete(state)
      return s && Date.now() - s.at < STATE_TTL_MS ? s : null
    },
  }
}

export function pgClaimStore(pool: import('pg').Pool): ClaimStore {
  const toRow = (x: Record<string, unknown>): AttestationRow => ({
    uri: x.uri as string, cid: x.cid as string, claimDid: x.claim_did as string, claimRkey: x.claim_rkey as string,
    claimCid: x.claim_cid as string, claimUri: (x.claim_uri as string | null) ?? '', result: x.result as AttestationRow['result'],
    method: (x.method as string | null) ?? '', createdAt: x.created_at as Date,
  })
  return {
    async upsertClaim(did, rkey, record) {
      await pool.query(
        `INSERT INTO claims (did, rkey, platform, uri, record) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (did, rkey) DO UPDATE SET platform = EXCLUDED.platform, uri = EXCLUDED.uri, record = EXCLUDED.record, indexed_at = now()`,
        [did, rkey, record.platform, record.uri, JSON.stringify(record)],
      )
    },
    async deleteClaim(did, rkey) {
      await pool.query('DELETE FROM claims WHERE did = $1 AND rkey = $2', [did, rkey])
    },
    async latestAttestations(did) {
      const r = await pool.query(
        `SELECT DISTINCT ON (claim_rkey) * FROM attestations WHERE claim_did = $1 ORDER BY claim_rkey, created_at DESC`,
        [did],
      )
      return r.rows.map(toRow)
    },
    async recordVerified(row) {
      const c = await pool.connect()
      try {
        await c.query('BEGIN')
        const old = await c.query(
          `UPDATE attestations SET result = 'revoked' WHERE claim_did = $1 AND claim_rkey = $2 AND result = 'verified' RETURNING uri`,
          [row.claimDid, row.claimRkey],
        )
        await c.query(
          `INSERT INTO attestations (uri, cid, claim_did, claim_rkey, claim_cid, claim_uri, result, method, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [row.uri, row.cid, row.claimDid, row.claimRkey, row.claimCid, row.claimUri, row.result, row.method, row.createdAt],
        )
        await c.query('COMMIT')
        return old.rows.map((x) => x.uri as string)
      } catch (err) {
        await c.query('ROLLBACK').catch(() => undefined)
        throw err
      } finally {
        c.release()
      }
    },
    async revokeForClaim(did, rkey) {
      const r = await pool.query(
        `UPDATE attestations SET result = 'revoked' WHERE claim_did = $1 AND claim_rkey = $2 AND result <> 'revoked' RETURNING uri`,
        [did, rkey],
      )
      return r.rows.map((x) => x.uri as string)
    },
    async mastodonApp(instance) {
      const r = await pool.query('SELECT client_id, client_secret, redirect_uri FROM mastodon_apps WHERE instance = $1', [instance])
      const x = r.rows[0]
      return x ? { instance, clientId: x.client_id, clientSecret: x.client_secret, redirectUri: x.redirect_uri } : null
    },
    async putMastodonApp(app) {
      await pool.query(
        `INSERT INTO mastodon_apps (instance, client_id, client_secret, redirect_uri) VALUES ($1, $2, $3, $4)
         ON CONFLICT (instance) DO UPDATE SET client_id = EXCLUDED.client_id, client_secret = EXCLUDED.client_secret, redirect_uri = EXCLUDED.redirect_uri`,
        [app.instance, app.clientId, app.clientSecret, app.redirectUri],
      )
    },
    async putState(p) {
      await pool.query('INSERT INTO verification_state (state, did, rkey, provider, instance) VALUES ($1, $2, $3, $4, $5)', [p.state, p.did, p.rkey, p.provider, p.instance ?? null])
      await pool.query("DELETE FROM verification_state WHERE created_at < now() - interval '1 hour'")
    },
    async takeState(state) {
      const r = await pool.query(
        `DELETE FROM verification_state WHERE state = $1 RETURNING did, rkey, provider, instance, created_at > now() - interval '15 minutes' AS fresh`,
        [state],
      )
      const x = r.rows[0]
      return x?.fresh ? { state, did: x.did, rkey: x.rkey, provider: x.provider, ...(x.instance ? { instance: x.instance } : {}) } : null
    },
  }
}

const g = globalThis as { __bvClaimStore?: ClaimStore }
export function getClaimStore(): ClaimStore {
  const pool = getPool()
  g.__bvClaimStore ??= pool ? pgClaimStore(pool) : memoryClaimStore()
  return g.__bvClaimStore
}
