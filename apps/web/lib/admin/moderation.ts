import type pg from 'pg'

export type AdminAction =
  | 'block_image' | 'unblock_image' | 'takedown' | 'suspend' | 'unsuspend' | 'dismiss_report' | 'appeal_upheld' | 'appeal_overturned'
  | 'acknowledge' | 'rating_change' | 'warn' | 'escalate' | 'reverse' | 'comment' | 'tag' | 'reveal_image' | 'divert' | 'notice_sent'
  | 'effect_offer_create' | 'effect_offer_change' | 'effect_offer_end'
export const DID_RE = /^did:(plc|web):[A-Za-z0-9._:%-]{1,200}$/
export const MAX_REASON = 500

type Q = Pick<pg.Pool, 'query'>

/** Extra audit fields from the review portal (migration 0031): the case, the policy cited, values behind the action, and a notice record. */
export type AuditMeta = { caseId?: number | null; policy?: string | null; detail?: Record<string, unknown> | null; noticeTemplate?: string | null; noticeResult?: string | null }

export async function recordAction(
  q: Q, actor: string, action: AdminAction, t: { did?: string | null; cid?: string | null; reportId?: number | null; reason?: string | null } & AuditMeta,
): Promise<number> {
  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO admin_actions (actor, action, target_did, target_cid, report_id, reason, case_id, policy, detail, notice_template, notice_result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::int AS id`,
    [actor, action, t.did ?? null, t.cid ?? null, t.reportId ?? null, t.reason ?? null, t.caseId ?? null, t.policy ?? null,
      t.detail ? JSON.stringify(t.detail) : null, t.noticeTemplate ?? null, t.noticeResult ?? null],
  )
  return rows[0]!.id
}

export type Result<T = object> = ({ ok: true; purged: boolean } & T) | { ok: false; error: string }

/** Validates a reason typed by an admin. Every decision needs one, and it goes in the audit log. */
export function cleanReason(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  return s && s.length <= MAX_REASON ? s : null
}

export async function inTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
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
export async function blockAll(c: Q, did: string, reason: string, by: string, kind: 'takedown' | 'suspension'): Promise<string[]> {
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

export type ActionRow = {
  id: number; actor: string; action: string; target_did: string | null; target_cid: string | null; report_id: number | null; reason: string | null; created_at: Date
  case_id: number | null; policy: string | null; notice_template: string | null; notice_result: string | null
}

export async function listActions(pool: pg.Pool, opts: { did?: string; limit?: number; caseId?: number } = {}): Promise<ActionRow[]> {
  const { rows } = await pool.query<ActionRow>(
    `SELECT id::int AS id, actor, action, target_did, target_cid, report_id::int AS report_id, reason, created_at, case_id::int AS case_id, policy, notice_template, notice_result
       FROM admin_actions WHERE ($1::text IS NULL OR target_did = $1) AND ($3::bigint IS NULL OR case_id = $3) ORDER BY created_at DESC, id DESC LIMIT $2`,
    [opts.did ?? null, opts.limit ?? 100, opts.caseId ?? null],
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
