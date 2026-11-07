import type pg from 'pg'
import type { Purge } from './purge'

export type AdminAction = 'block_image' | 'unblock_image' | 'takedown' | 'suspend' | 'unsuspend' | 'dismiss_report'
export const DID_RE = /^did:(plc|web):[A-Za-z0-9._:%-]{1,200}$/
export const MAX_REASON = 500

type Q = Pick<pg.Pool, 'query'>

export async function recordAction(
  q: Q, actor: string, action: AdminAction, t: { did?: string | null; cid?: string | null; reportId?: number | null; reason?: string | null },
): Promise<void> {
  await q.query(
    'INSERT INTO admin_actions (actor, action, target_did, target_cid, report_id, reason) VALUES ($1, $2, $3, $4, $5, $6)',
    [actor, action, t.did ?? null, t.cid ?? null, t.reportId ?? null, t.reason ?? null],
  )
}

export type Result<T = object> = ({ ok: true; purged: boolean } & T) | { ok: false; error: string }

/** Validates a reason typed by an admin. Every decision needs one, and it goes in the audit log. */
export function cleanReason(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  return s && s.length <= MAX_REASON ? s : null
}

async function inTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    c.release()
  }
}

/** Blocks every indexed image of the DID with the given kind. A takedown is never downgraded by a later suspension. */
async function blockAll(c: Q, did: string, reason: string, by: string, kind: 'takedown' | 'suspension'): Promise<string[]> {
  const { rows } = await c.query<{ cid: string }>('SELECT DISTINCT cid FROM images WHERE did = $1', [did])
  for (const { cid } of rows) {
    await c.query(
      `INSERT INTO blocked_images (did, cid, reason, blocked_by, kind) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (did, cid) DO UPDATE SET
         reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by, blocked_at = now(), unblocked_at = NULL,
         kind = CASE WHEN EXCLUDED.kind = 'suspension' AND blocked_images.unblocked_at IS NULL THEN blocked_images.kind ELSE EXCLUDED.kind END`,
      [did, cid, reason, by, kind],
    )
  }
  return rows.map((r) => r.cid)
}

/** Takedown: blocks all images, marks the report (or all open reports for the DID) actioned, and audits it. */
export async function takedown(pool: pg.Pool, purge: Purge, actor: string, did: string, reason: string, reportId?: number): Promise<Result<{ blocked: number; reportIds: number[] }>> {
  if (!DID_RE.test(did)) return { ok: false, error: 'Unknown account.' }
  const { cids, reportIds } = await inTx(pool, async (c) => {
    const list = await blockAll(c, did, reason, actor, 'takedown')
    const { rows } = await c.query<{ id: number }>(
      `UPDATE reports SET status = 'actioned', actioned_by = $2, action_reason = $3, actioned_at = now()
       WHERE target_did = $1 AND status = 'open' AND ($4::bigint IS NULL OR id = $4) RETURNING id::int AS id`,
      [did, actor, reason, reportId ?? null],
    )
    await recordAction(c, actor, 'takedown', { did, reportId, reason })
    return { cids: list, reportIds: rows.map((r) => r.id) }
  })
  return { ok: true, purged: cids.length === 0 || (await purge(did, cids)), blocked: cids.length, reportIds }
}

export async function suspend(pool: pg.Pool, purge: Purge, actor: string, did: string, reason: string): Promise<Result<{ blocked: number }>> {
  if (!DID_RE.test(did)) return { ok: false, error: 'Unknown account.' }
  const cids = await inTx(pool, async (c) => {
    const { rowCount } = await c.query(
      `INSERT INTO account_suspensions (did, reason, suspended_by) VALUES ($1, $2, $3)
       ON CONFLICT (did) DO UPDATE SET reason = EXCLUDED.reason, suspended_by = EXCLUDED.suspended_by, suspended_at = now(), lifted_at = NULL, lifted_by = NULL
       WHERE account_suspensions.lifted_at IS NOT NULL`,
      [did, reason, actor],
    )
    if (!rowCount) return null
    const list = await blockAll(c, did, reason, actor, 'suspension')
    await recordAction(c, actor, 'suspend', { did, reason })
    return list
  })
  if (cids === null) return { ok: false, error: 'Account is already suspended.' }
  return { ok: true, purged: cids.length === 0 || (await purge(did, cids)), blocked: cids.length }
}

/** Lifts the suspension and unblocks only the images that the suspension blocked. */
export async function unsuspend(pool: pg.Pool, purge: Purge, actor: string, did: string, reason: string): Promise<Result<{ restored: number }>> {
  if (!DID_RE.test(did)) return { ok: false, error: 'Unknown account.' }
  const cids = await inTx(pool, async (c) => {
    const { rowCount } = await c.query('UPDATE account_suspensions SET lifted_at = now(), lifted_by = $2 WHERE did = $1 AND lifted_at IS NULL', [did, actor])
    if (!rowCount) return null
    const { rows } = await c.query<{ cid: string }>(
      "UPDATE blocked_images SET unblocked_at = now() WHERE did = $1 AND kind = 'suspension' AND unblocked_at IS NULL RETURNING cid",
      [did],
    )
    await recordAction(c, actor, 'unsuspend', { did, reason })
    return rows.map((r) => r.cid)
  })
  if (cids === null) return { ok: false, error: 'Account is not suspended.' }
  return { ok: true, purged: cids.length === 0 || (await purge(did, cids)), restored: cids.length }
}

/** Lifts one image block (any kind), for example after a successful appeal. */
export async function unblockImage(pool: pg.Pool, purge: Purge, actor: string, did: string, cid: string, reason: string): Promise<Result> {
  if (!DID_RE.test(did) || !/^[A-Za-z0-9]{10,200}$/.test(cid)) return { ok: false, error: 'Unknown image.' }
  const done = await inTx(pool, async (c) => {
    const { rowCount } = await c.query('UPDATE blocked_images SET unblocked_at = now() WHERE did = $1 AND cid = $2 AND unblocked_at IS NULL', [did, cid])
    if (!rowCount) return false
    await recordAction(c, actor, 'unblock_image', { did, cid, reason })
    return true
  })
  if (!done) return { ok: false, error: 'No active block for that image.' }
  return { ok: true, purged: await purge(did, [cid]) }
}

export async function dismissReport(pool: pg.Pool, actor: string, reportId: number, reason: string): Promise<Result> {
  const done = await inTx(pool, async (c) => {
    const { rows } = await c.query<{ target_did: string }>(
      `UPDATE reports SET status = 'dismissed', actioned_by = $2, action_reason = $3, actioned_at = now()
       WHERE id = $1 AND status = 'open' RETURNING target_did`,
      [reportId, actor, reason],
    )
    if (!rows[0]) return false
    await recordAction(c, actor, 'dismiss_report', { did: rows[0].target_did, reportId, reason })
    return true
  })
  return done ? { ok: true, purged: true } : { ok: false, error: 'Report is not open.' }
}

export type ReportRow = {
  id: number; target_did: string; source: string; reason: string; details: string | null; created_at: Date; status: string
  actioned_by: string | null; action_reason: string | null; actioned_at: Date | null; target_report_count: number; has_contact: boolean
}

const REPORT_COLS = `r.id::int AS id, r.target_did, r.source, r.reason, r.details, r.created_at, r.status, r.actioned_by, r.action_reason, r.actioned_at,
  (SELECT count(*)::int FROM reports x WHERE x.target_did = r.target_did) AS target_report_count,
  (r.reporter_contact IS NOT NULL) AS has_contact`

/** The reporter contact and IP hash are never selected: admins triage content, not reporters. */
export async function listReports(pool: pg.Pool, status: 'open' | 'actioned' | 'dismissed' | 'all', limit = 100): Promise<ReportRow[]> {
  const { rows } = await pool.query<ReportRow>(
    `SELECT ${REPORT_COLS} FROM reports r WHERE ($1 = 'all' OR r.status = $1) ORDER BY r.created_at DESC LIMIT $2`,
    [status, limit],
  )
  return rows
}

export async function getReport(pool: pg.Pool, id: number): Promise<ReportRow | null> {
  const { rows } = await pool.query<ReportRow>(`SELECT ${REPORT_COLS} FROM reports r WHERE r.id = $1`, [id])
  return rows[0] ?? null
}

export type ActionRow = { id: number; actor: string; action: string; target_did: string | null; target_cid: string | null; report_id: number | null; reason: string | null; created_at: Date }

export async function listActions(pool: pg.Pool, opts: { did?: string; limit?: number } = {}): Promise<ActionRow[]> {
  const { rows } = await pool.query<ActionRow>(
    `SELECT id::int AS id, actor, action, target_did, target_cid, report_id::int AS report_id, reason, created_at
       FROM admin_actions WHERE ($1::text IS NULL OR target_did = $1) ORDER BY created_at DESC, id DESC LIMIT $2`,
    [opts.did ?? null, opts.limit ?? 100],
  )
  return rows
}

export type AccountSummary = {
  did: string
  repo: { handle: string | null; active: boolean; status: string | null } | null
  images: { cid: string; rkey: string; rating: string; is_default: boolean }[]
  blocked: { cid: string; reason: string | null; kind: string; blocked_by: string | null; blocked_at: Date }[]
  reports: { open: number; total: number }
  license: { tier: string; status: string } | null
  subscriptions: { tier: string; status: string; cancel_at_period_end: boolean }[]
  emailHolds: number
  suspension: { reason: string; suspended_by: string; suspended_at: Date } | null
  actions: ActionRow[]
}

/** Read-only view of one account: repo status, images and ratings, blocks, reports, license, subscriptions, holds, and prior actions. */
export async function accountSummary(pool: pg.Pool, did: string): Promise<AccountSummary> {
  const one = async <T extends pg.QueryResultRow>(sql: string) => (await pool.query<T>(sql, [did])).rows
  const [repo, images, blocked, reports, license, subs, holds, susp] = await Promise.all([
    one<{ handle: string | null; active: boolean; status: string | null }>('SELECT handle, active, status FROM repos WHERE did = $1'),
    one<AccountSummary['images'][number]>('SELECT cid, rkey, rating, is_default FROM images WHERE did = $1 ORDER BY created_at DESC LIMIT 200'),
    one<AccountSummary['blocked'][number]>('SELECT cid, reason, kind, blocked_by, blocked_at FROM blocked_images WHERE did = $1 AND unblocked_at IS NULL ORDER BY blocked_at DESC'),
    one<{ open: number; total: number }>("SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*)::int AS total FROM reports WHERE target_did = $1"),
    one<{ tier: string; status: string }>('SELECT tier, status FROM licenses WHERE owner = $1 AND org_id IS NULL ORDER BY created_at DESC LIMIT 1'),
    one<AccountSummary['subscriptions'][number]>('SELECT tier, status, cancel_at_period_end FROM subscriptions WHERE did = $1 ORDER BY updated_at DESC'),
    one<{ n: number }>("SELECT count(*)::int AS n FROM email_holds WHERE did = $1 AND released_at > now() - interval '30 days'"),
    one<NonNullable<AccountSummary['suspension']>>('SELECT reason, suspended_by, suspended_at FROM account_suspensions WHERE did = $1 AND lifted_at IS NULL'),
  ])
  return {
    did, repo: repo[0] ?? null, images, blocked, reports: reports[0] ?? { open: 0, total: 0 }, license: license[0] ?? null,
    subscriptions: subs, emailHolds: holds[0]?.n ?? 0, suspension: susp[0] ?? null, actions: await listActions(pool, { did, limit: 50 }),
  }
}
