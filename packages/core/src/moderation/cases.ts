import { deriveSeverity, isChildSafety, SEVERITIES, severityRank, type Severity, type SignalKind } from './config.js'

/** What the review code needs from pg.Pool or a PoolClient, so core stays free of the pg dependency. */
export type Query = { query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, any>>; rowCount?: number | null }> }

export type Signal = {
  did: string
  /** The image CID when the signal is about one image. Reports are about an account, so they have none. */
  cid?: string | null
  kind: SignalKind
  category: string
  /** The scanner service or label value. Null for reports and appeals. */
  source?: string | null
  reportId?: number
  appealId?: number
  at?: Date
}

const ORDER = `ARRAY[${SEVERITIES.map((s) => `'${s}'`).join(', ')}]`

/**
 * Adds a signal to the open case for its image (CID) or account (DID), or opens one. One open case per subject:
 *  - a signal with a CID joins the open case for that CID; failing that, an open account-level case for the DID
 *    (which then becomes the case for that CID); failing that, it opens a new case.
 *  - a signal without a CID joins the oldest open case for the DID.
 *  - an appeal always opens its own case.
 * The case takes the most severe of its signals and the oldest signal time. Child safety signals move it to the restricted queue.
 * Every step is idempotent, so the web app and the indexer can both run it.
 */
export async function attachSignal(q: Query, s: Signal): Promise<{ caseId: number; created: boolean }> {
  const at = s.at ?? new Date()
  const severity = deriveSeverity(s.kind, s.category)
  const child = isChildSafety(s.category)
  const cid = s.cid ?? null
  let id: number | null = null
  let created = false

  if (s.kind === 'appeal') {
    const key = `appeal:${s.appealId ?? 0}`
    const ex = await q.query("SELECT id::int AS id FROM review_cases WHERE dedupe_key = $1 AND status <> 'resolved'", [key])
    id = ex.rows[0]?.id ?? null
    if (id === null) {
      const ins = await q.query(
        `INSERT INTO review_cases (dedupe_key, subject_did, subject_cid, status, severity, opened_at) VALUES ($1, $2, $3, 'appeal', $4, $5)
         ON CONFLICT (dedupe_key) WHERE status <> 'resolved' DO NOTHING RETURNING id::int AS id`,
        [key, s.did, cid, severity, at],
      )
      id = ins.rows[0]?.id ?? null
      created = id !== null
    }
  } else {
    if (cid) {
      const byCid = await q.query("SELECT id::int AS id FROM review_cases WHERE dedupe_key = $1 AND status <> 'resolved'", [`cid:${cid}`])
      id = byCid.rows[0]?.id ?? null
    }
    if (id === null) {
      // An account-level case without an image yet absorbs the first image-level signal; a CID-less signal joins any open case for the DID.
      const byDid = await q.query(
        `SELECT id::int AS id FROM review_cases WHERE subject_did = $1 AND status <> 'resolved' AND dedupe_key NOT LIKE 'appeal:%'
           AND ($2::text IS NULL OR subject_cid IS NULL) ORDER BY opened_at, id LIMIT 1`,
        [s.did, cid],
      )
      id = byDid.rows[0]?.id ?? null
      if (id !== null && cid) await q.query('UPDATE review_cases SET subject_cid = $2, dedupe_key = $3 WHERE id = $1', [id, cid, `cid:${cid}`])
    }
    if (id === null) {
      const key = cid ? `cid:${cid}` : `did:${s.did}`
      const ins = await q.query(
        `INSERT INTO review_cases (dedupe_key, subject_did, subject_cid, severity, opened_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (dedupe_key) WHERE status <> 'resolved' DO NOTHING RETURNING id::int AS id`,
        [key, s.did, cid, severity, at],
      )
      id = ins.rows[0]?.id ?? null
      created = id !== null
      if (id === null) {
        const again = await q.query("SELECT id::int AS id FROM review_cases WHERE dedupe_key = $1 AND status <> 'resolved'", [key])
        id = again.rows[0]?.id ?? null
      }
    }
  }
  if (id === null) throw new Error('could not open or find a case')

  await q.query(
    `INSERT INTO case_signals (case_id, kind, category, source, report_id, appeal_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [id, s.kind, s.category, s.source ?? null, s.reportId ?? null, s.appealId ?? null, at],
  )
  await q.query(
    `UPDATE review_cases SET
        severity = CASE WHEN array_position(${ORDER}, $2::text) < array_position(${ORDER}, severity) THEN $2 ELSE severity END,
        child_safety = child_safety OR $3,
        opened_at = LEAST(opened_at, $4)
      WHERE id = $1`,
    [id, severity, child, at],
  )
  return { caseId: id, created }
}

/** Opens or updates cases for open reports that have none yet. Returns how many were attached. Reporter contact and IP hash are never read. */
export async function syncReports(q: Query): Promise<number> {
  const { rows } = await q.query(
    `SELECT r.id::int AS id, r.target_did, r.reason, r.created_at FROM reports r
      WHERE r.status = 'open' AND NOT EXISTS (SELECT 1 FROM case_signals s WHERE s.report_id = r.id) ORDER BY r.id LIMIT 500`,
  )
  for (const r of rows) await attachSignal(q, { did: r.target_did, kind: 'report', category: r.reason, reportId: r.id, at: r.created_at })
  return rows.length
}

/** Opens a case in the Appeals queue for each open appeal that has none. */
export async function syncAppeals(q: Query): Promise<number> {
  const { rows } = await q.query(
    `SELECT p.id::int AS id, p.did, p.created_at FROM appeals p
      WHERE p.status = 'open' AND NOT EXISTS (SELECT 1 FROM case_signals s WHERE s.appeal_id = p.id) ORDER BY p.id LIMIT 500`,
  )
  for (const a of rows) await attachSignal(q, { did: a.did, kind: 'appeal', category: 'appeal', appealId: a.id, at: a.created_at })
  return rows.length
}

export async function syncCases(q: Query): Promise<{ reports: number; appeals: number }> {
  return { reports: await syncReports(q), appeals: await syncAppeals(q) }
}

