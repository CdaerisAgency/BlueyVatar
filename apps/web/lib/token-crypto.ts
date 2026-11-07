import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Encryption at rest for OAuth session and state payloads (oauth_session.value, oauth_state.value).
 * AES-256-GCM, stored as `v1:<iv>:<tag>:<ciphertext>` with each part base64 encoded.
 *
 * Key: TOKEN_ENCRYPTION_KEY, 32 random bytes as base64 or hex (`openssl rand -base64 32`). The AES
 * key is derived from it with HKDF-SHA256 so the raw secret is never used directly.
 *
 * Rollout and legacy rows: before migration 0007 these columns held plaintext JSON. Reads accept
 * both forms. A value starting with `v1:` is decrypted; anything else is parsed as legacy
 * plaintext JSON. Writes always encrypt, so a legacy row is re-encrypted the next time the OAuth
 * client saves that session (every token refresh) and abandoned state rows expire within an hour.
 * To roll out: set TOKEN_ENCRYPTION_KEY on web, deploy (delivery applies 0007), and nobody has to
 * sign in again. Rotating the key invalidates stored sessions, which forces a fresh sign-in.
 */
const PREFIX = 'v1'
const DEV_KEY = Buffer.alloc(32, 'blueyvatar-dev-token-key')
let warned = false

/** Parses the env value into 32 bytes, or throws. */
export function parseKey(raw: string): Buffer {
  const s = raw.trim()
  const buf = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64')
  if (buf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 or hex (openssl rand -base64 32)')
  return buf
}

/** The master key. Throws in production when unset; falls back to a fixed dev key elsewhere. */
export function masterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  if (env.TOKEN_ENCRYPTION_KEY) return parseKey(env.TOKEN_ENCRYPTION_KEY)
  if (env.NODE_ENV === 'production') throw new Error('TOKEN_ENCRYPTION_KEY is not set')
  if (!warned) {
    warned = true
    console.warn('TOKEN_ENCRYPTION_KEY is not set; using a fixed development key. Do not use this outside local development.')
  }
  return DEV_KEY
}

/** Fail fast at startup. */
export function assertTokenKey(env: NodeJS.ProcessEnv = process.env): void {
  masterKey(env)
}

function aesKey(master: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'blueyvatar oauth token encryption v1', 32))
}

export function encryptJson(value: unknown, master: Buffer = masterKey()): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', aesKey(master), iv)
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()])
  return [PREFIX, iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

/** Decrypts `v1:` values (throws if tampered or the key is wrong); unprefixed text is legacy plaintext JSON. */
export function decryptJson<T>(stored: unknown, master: Buffer = masterKey()): T {
  if (typeof stored !== 'string') return stored as T // jsonb driver value from before 0007
  if (!stored.startsWith(`${PREFIX}:`)) return JSON.parse(stored) as T
  const [, iv, tag, ct] = stored.split(':')
  if (!iv || !tag || !ct) throw new Error('Malformed encrypted token payload')
  const d = createDecipheriv('aes-256-gcm', aesKey(master), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')) as T
}
