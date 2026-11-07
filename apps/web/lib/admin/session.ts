import { createHash, randomBytes } from 'node:crypto'
import type pg from 'pg'
import { ADMIN_SESSION_TTL_MS } from './config'
import { matchStep } from './totp'

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

/** Starts an admin session and returns the cookie token. The database keeps only the token's hash. */
export async function createAdminSession(pool: pg.Pool, did: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await pool.query('INSERT INTO admin_sessions (token_hash, did, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
    hashToken(token), did, now, new Date(now.getTime() + ADMIN_SESSION_TTL_MS),
  ])
  return token
}

/** The admin DID for a live token that still belongs to the signed-in DID, else null. */
export async function readAdminSession(pool: pg.Pool, token: string | undefined, did: string, now = new Date()): Promise<string | null> {
  if (!token) return null
  const { rows } = await pool.query<{ did: string }>(
    'SELECT did FROM admin_sessions WHERE token_hash = $1 AND did = $2 AND revoked_at IS NULL AND expires_at > $3',
    [hashToken(token), did, now],
  )
  return rows[0]?.did ?? null
}

export async function revokeAdminSession(pool: pg.Pool, token: string | undefined, now = new Date()): Promise<void> {
  if (token) await pool.query('UPDATE admin_sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token), now])
}

/** Checks a one-time code and burns its step, so the same code cannot start a second session. */
export async function consumeTotp(pool: pg.Pool, did: string, secretB32: string, code: string, now = new Date()): Promise<boolean> {
  const step = matchStep(secretB32, code, now.getTime())
  if (step === null) return false
  const { rowCount } = await pool.query('INSERT INTO admin_totp_used (did, step) VALUES ($1, $2) ON CONFLICT DO NOTHING', [did, step])
  await pool.query("DELETE FROM admin_totp_used WHERE used_at < $1::timestamptz - interval '1 day'", [now])
  return rowCount === 1
}
