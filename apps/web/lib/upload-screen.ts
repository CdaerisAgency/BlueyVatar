import { SCAN_OUTAGE_MESSAGE, SCAN_REJECT_MESSAGE, decideScan, scannerFromEnv, type ContentScanner } from '@blueyvatar/core'
import { getPool } from './store'
import { log, metrics } from './obs'

/**
 * Upload-time screening (issue #207). Runs after downscaling and before the blob is written to the PDS.
 * Never logs or stores image bytes. A match writes a restricted event (account, service, flag, time) and
 * is counted in `upload_scan_events` for the daily digest and in the `web_upload_screen_total` metric.
 * Match: always blocked. Scanner outage: allowed with a logged warning unless SCAN_FAIL_CLOSED=1.
 */
export type ScreenResult = { ok: true } | { ok: false; error: string }

export interface ScreenDeps {
  scanner: ContentScanner
  record: (e: { did: string; service: string; outcome: 'match' | 'outage_blocked' | 'outage_allowed'; flags: string[] }) => Promise<void>
  env?: { SCAN_FAIL_CLOSED?: string | undefined }
}

export async function screenWith(deps: ScreenDeps, did: string, bytes: Uint8Array, mime: string): Promise<ScreenResult> {
  const result = await deps.scanner.scan(bytes, mime)
  const decision = decideScan(result, deps.env)
  if (decision.outcome === 'clear') return { ok: true }
  const service = result.status === 'clear' ? deps.scanner.name : result.service
  const flags = decision.allow ? [] : decision.flags
  metrics.inc('web_upload_screen_total', { outcome: decision.outcome })
  if (result.status === 'error') log.warn('upload screening unavailable', { service, reason: result.reason, failClosed: !decision.allow })
  // The log line and the event carry no image data. A failed write must not turn a match into an upload.
  await deps.record({ did, service, outcome: decision.outcome, flags }).catch((err) => log.error('scan event write failed', { err }))
  if (decision.allow) return { ok: true }
  return { ok: false, error: decision.outcome === 'match' ? SCAN_REJECT_MESSAGE : SCAN_OUTAGE_MESSAGE }
}

let scanner: ContentScanner | undefined

export function screenUpload(did: string, bytes: Uint8Array, mime: string): Promise<ScreenResult> {
  scanner ??= scannerFromEnv()
  return screenWith(
    {
      scanner,
      env: { SCAN_FAIL_CLOSED: process.env.SCAN_FAIL_CLOSED },
      record: async (e) => {
        const pool = getPool()
        if (!pool) return
        await pool.query('INSERT INTO upload_scan_events (did, service, outcome, flags) VALUES ($1, $2, $3, $4)', [e.did, e.service, e.outcome, e.flags])
      },
    },
    did, bytes, mime,
  )
}

/** Counts per outcome and service in a window, for the daily digest. */
export async function scanCounts(pool: NonNullable<ReturnType<typeof getPool>>, since: Date): Promise<{ outcome: string; service: string; n: number }[]> {
  const { rows } = await pool.query<{ outcome: string; service: string; n: number }>(
    'SELECT outcome, service, count(*)::int AS n FROM upload_scan_events WHERE created_at >= $1 GROUP BY outcome, service ORDER BY outcome, service',
    [since],
  )
  return rows
}
