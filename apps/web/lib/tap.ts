import { getPool } from './store'
import { log } from './obs'

/**
 * Asks Tap to follow an account at sign-in (issue #223), so the indexer writes the `repos` row right away.
 * Tap's `POST /repos/add` takes a JSON body `{"dids": [...]}` and HTTP Basic auth, user `admin`, password
 * `TAP_ADMIN_PASSWORD` (cmd/tap/README.md in bluesky-social/indigo, tag tap-v0.1.10, "HTTP API" and
 * "Authentication"). Env names match the indexer: `TAP_URL`, `TAP_ADMIN_PASSWORD`.
 * Best effort: short timeout, never throws, skipped when the env vars are unset or the row exists.
 */
const TIMEOUT_MS = 2000

export interface TapDeps {
  pool?: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> } | null
  fetchFn?: typeof fetch
  env?: { TAP_URL?: string; TAP_ADMIN_PASSWORD?: string }
}

export async function trackAccountInTap(did: string, deps: TapDeps = {}): Promise<void> {
  try {
    const env = deps.env ?? process.env
    const url = env.TAP_URL
    const password = env.TAP_ADMIN_PASSWORD
    if (!url || !password) {
      log.info('tap tracking skipped: TAP_URL or TAP_ADMIN_PASSWORD is not set')
      return
    }
    const pool = deps.pool === undefined ? getPool() : deps.pool
    if (pool) {
      const { rows } = await pool.query('SELECT 1 FROM repos WHERE did = $1', [did])
      if (rows.length > 0) return
    }
    const res = await (deps.fetchFn ?? fetch)(new URL('/repos/add', url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`,
      },
      body: JSON.stringify({ dids: [did] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) log.warn('tap repos/add refused', { status: res.status })
  } catch (err) {
    log.warn('tap repos/add failed', { reason: err instanceof Error ? err.name : 'error' })
  }
}
