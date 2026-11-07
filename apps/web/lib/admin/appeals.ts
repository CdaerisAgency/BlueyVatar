import type pg from 'pg'
import { inTx, MAX_REASON, recordAction, type AuditMeta, type Result } from './moderation'
import type { Purge } from './purge'

export type AppealRow = {
  id: number; did: string; action_id: number; statement: string; status: string; created_at: Date
  decided_by: string | null; decision_note: string | null; decided_at: Date | null
  action: string; action_by: string; action_reason: string | null; action_at: Date
}

export async function listAppeals(pool: Pick<pg.Pool, 'query'>, status: 'open' | 'decided' = 'open', limit = 100): Promise<AppealRow[]> {
  const { rows } = await pool.query<AppealRow>(
    `SELECT p.id::int AS id, p.did, p.action_id::int AS action_id, p.statement, p.status, p.created_at, p.decided_by, p.decision_note, p.decided_at,
            a.action, a.actor AS action_by, a.reason AS action_reason, a.created_at AS action_at
       FROM appeals p JOIN admin_actions a ON a.id = p.action_id
      WHERE ($1 = 'open') = (p.status = 'open')
      ORDER BY CASE WHEN p.status = 'open' THEN p.created_at END ASC, p.decided_at DESC LIMIT $2`,
    [status, limit],
  )
  return rows
}

/**
 * Decides an open appeal. The decision is written to the audit log in the same transaction. Overturning also reverses the
 * original action: a takedown unblocks the images it blocked, a suspension is lifted. Someone other than the original
 * reviewer must decide.
 */
export async function decideAppeal(
  pool: pg.Pool, purge: Purge, actor: string, appealId: number, outcome: 'upheld' | 'overturned', note: string, meta: AuditMeta = {},
): Promise<Result<{ did: string; appealId: number; outcome: 'upheld' | 'overturned' }>> {
  const done = await inTx(pool, async (c) => {
    const { rows } = await c.query<{ did: string; action: string; actor: string }>(
      `SELECT p.did, a.action, a.actor FROM appeals p JOIN admin_actions a ON a.id = p.action_id
        WHERE p.id = $1 AND p.status = 'open' FOR UPDATE OF p`,
      [appealId],
    )
    const ap = rows[0]
    if (!ap) return { error: 'Appeal is not open.' }
    if (ap.actor === actor) return { error: 'A different admin than the one who took the action must decide this appeal.' }
    await c.query("UPDATE appeals SET status = $2, decided_by = $3, decision_note = $4, decided_at = now() WHERE id = $1", [appealId, outcome, actor, note])
    const reason = `appeal #${appealId}: ${note}`.slice(0, MAX_REASON + 20)
    await recordAction(c, actor, outcome === 'upheld' ? 'appeal_upheld' : 'appeal_overturned', { did: ap.did, reason, ...meta })
    let cids: string[] = []
    if (outcome === 'overturned') {
      if (ap.action === 'suspend') {
        const lifted = await c.query('UPDATE account_suspensions SET lifted_at = now(), lifted_by = $2 WHERE did = $1 AND lifted_at IS NULL', [ap.did, actor])
        if (lifted.rowCount) await recordAction(c, actor, 'unsuspend', { did: ap.did, reason, ...meta })
      }
      if (ap.action === 'rating_change') {
        const o = await c.query<{ cid: string; prior_rating: string }>('UPDATE rating_overrides SET lifted_at = now() WHERE did = $1 AND lifted_at IS NULL RETURNING cid, prior_rating', [ap.did])
        for (const x of o.rows) await c.query('UPDATE images SET rating = $3 WHERE did = $1 AND cid = $2', [ap.did, x.cid, x.prior_rating])
        cids = o.rows.map((x) => x.cid)
      } else if (ap.action !== 'warn') {
        const kind = ap.action === 'suspend' ? 'suspension' : 'takedown'
        const r = await c.query<{ cid: string }>(
          'UPDATE blocked_images SET unblocked_at = now() WHERE did = $1 AND kind = $2 AND unblocked_at IS NULL RETURNING cid',
          [ap.did, kind],
        )
        cids = r.rows.map((x) => x.cid)
      }
    }
    return { did: ap.did, cids }
  })
  if ('error' in done) return { ok: false, error: done.error! }
  return { ok: true, purged: done.cids.length === 0 || (await purge(done.did, done.cids)), did: done.did, appealId, outcome }
}
