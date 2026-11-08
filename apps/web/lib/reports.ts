import { createHash } from 'node:crypto'
import type pg from 'pg'

export const REASONS = ['child_safety', 'illegal', 'copyright', 'explicit', 'impersonation', 'harassment', 'private_info', 'spam', 'other'] as const
export type Reason = (typeof REASONS)[number]
export type Source = 'profile' | 'avatar'

export const REASON_LABELS: Record<Reason, string> = {
  child_safety: 'Child safety concern',
  illegal: 'Illegal content',
  copyright: 'Copyright or trademark infringement',
  explicit: 'Explicit content rated too low',
  impersonation: 'Impersonation',
  harassment: 'Threats or harassment',
  private_info: 'Private information',
  spam: 'Spam or scams',
  other: 'Something else',
}

/** Submissions allowed per IP in the window. */
export const RATE_LIMIT = 5
/** Submissions allowed per signed-in account in the window, in addition to the per-IP limit. */
export const RATE_LIMIT_DID = 5
export const RATE_WINDOW_MS = 60 * 60 * 1000
export const MIN_DETAILS = 10
export const MAX_DETAILS = 2000
export const MAX_CONTACT = 254

export type ReportField = 'did' | 'reason' | 'details' | 'contact'
export type ReportInput = { did: string; reporterDid: string; source: Source; reason: Reason; details: string; contact: string }
export type Parsed = { ok: true; value: ReportInput } | { ok: false; error: string; field: ReportField }

const DID_RE = /^did:(plc|web):[A-Za-z0-9._:%-]{1,200}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Validates raw form values. Pure, so it is easy to test. Reason, details, and email are all required. */
export function parseReport(raw: { did?: unknown; reporterDid?: unknown; source?: unknown; reason?: unknown; details?: unknown; contact?: unknown }): Parsed {
  const did = String(raw.did ?? '')
  if (!DID_RE.test(did)) return { ok: false, error: 'Unknown account.', field: 'did' }
  const reporterDid = String(raw.reporterDid ?? '')
  if (!DID_RE.test(reporterDid)) return { ok: false, error: 'Sign in to report.', field: 'did' }
  const source = raw.source === 'avatar' ? 'avatar' : 'profile'
  const reason = String(raw.reason ?? '') as Reason
  if (!REASONS.includes(reason)) return { ok: false, error: 'Choose a reason.', field: 'reason' }
  const details = String(raw.details ?? '').trim()
  if (!details) return { ok: false, error: 'Add details about the problem.', field: 'details' }
  if (details.length < MIN_DETAILS) return { ok: false, error: `Details need at least ${MIN_DETAILS} characters.`, field: 'details' }
  if (details.length > MAX_DETAILS) return { ok: false, error: `Details are limited to ${MAX_DETAILS} characters.`, field: 'details' }
  const contact = String(raw.contact ?? '').trim()
  if (!contact) return { ok: false, error: 'Enter your email so we can follow up.', field: 'contact' }
  if (contact.length > MAX_CONTACT) return { ok: false, error: 'Email is too long.', field: 'contact' }
  if (!EMAIL_RE.test(contact)) return { ok: false, error: 'Enter a valid email address.', field: 'contact' }
  return { ok: true, value: { did, reporterDid, source, reason, details, contact } }
}

export function hashIp(ip: string, secret: string): string {
  return createHash('sha256').update(`${secret}\n${ip}`).digest('hex')
}

export type SubmitResult = { ok: true; id: number } | { ok: false; error: 'rate_limited' }

/**
 * Stores a report unless the IP already filed RATE_LIMIT, or the reporter's account RATE_LIMIT_DID, in the window. The count lives in Postgres so
 * every web instance shares it. Nothing here logs the contact or the IP.
 */
export async function submitReport(pool: pg.Pool, input: ReportInput, ipHash: string, now = new Date()): Promise<SubmitResult> {
  const since = new Date(now.getTime() - RATE_WINDOW_MS)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Serializes concurrent submissions from one IP so the limit cannot be raced.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ipHash])
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.reporterDid])
    const { rows: counted } = await client.query('SELECT count(*)::int AS n FROM reports WHERE ip_hash = $1 AND created_at > $2', [ipHash, since])
    const { rows: byDid } = await client.query('SELECT count(*)::int AS n FROM reports WHERE reporter_did = $1 AND created_at > $2', [input.reporterDid, since])
    if (counted[0].n >= RATE_LIMIT || byDid[0].n >= RATE_LIMIT_DID) {
      await client.query('ROLLBACK')
      return { ok: false, error: 'rate_limited' }
    }
    const { rows } = await client.query(
      `INSERT INTO reports (target_did, source, reason, details, reporter_contact, ip_hash, created_at, reporter_did)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [input.did, input.source, input.reason, input.details, input.contact, ipHash, now, input.reporterDid],
    )
    await client.query('COMMIT')
    return { ok: true, id: Number(rows[0].id) }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
