import type pg from 'pg'

export const MAX_STATEMENT = 2000

type Q = Pick<pg.Pool, 'query'>

export type AppealableAction = { id: number; action: 'takedown' | 'suspend'; created_at: Date; appeal: { status: string } | null }

/**
 * Takedowns and suspensions of this account that are still in effect, newest first. A takedown counts while any image it
 * blocked is still blocked; a suspension counts while it is the current, unlifted one. Each action shows its appeal, if any,
 * because only one appeal is allowed per action.
 */
export async function appealableActions(pool: Q, did: string): Promise<AppealableAction[]> {
  const { rows } = await pool.query<AppealableAction>(
    `SELECT a.id::int AS id, a.action, a.created_at, CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('status', p.status) END AS appeal
       FROM admin_actions a LEFT JOIN appeals p ON p.action_id = a.id
      WHERE a.target_did = $1 AND a.action IN ('takedown', 'suspend') AND (
        (a.action = 'takedown' AND EXISTS (SELECT 1 FROM blocked_images b WHERE b.did = $1 AND b.kind = 'takedown' AND b.unblocked_at IS NULL))
        OR (a.action = 'suspend' AND EXISTS (SELECT 1 FROM account_suspensions s WHERE s.did = $1 AND s.lifted_at IS NULL)
            AND a.id = (SELECT max(x.id) FROM admin_actions x WHERE x.target_did = $1 AND x.action = 'suspend')))
      ORDER BY a.id DESC`,
    [did],
  )
  return rows
}

export type AppealResult = { ok: true; id: number } | { ok: false; error: 'invalid' | 'not_eligible' | 'duplicate' }

export function cleanStatement(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  return s && s.length <= MAX_STATEMENT ? s : null
}

/** Files the one appeal allowed for an action. The signed-in account must be the target and the action must still be in effect. */
export async function submitAppeal(pool: Q, did: string, actionId: number, statement: unknown): Promise<AppealResult> {
  const text = cleanStatement(statement)
  if (!text || !Number.isSafeInteger(actionId) || actionId <= 0) return { ok: false, error: 'invalid' }
  const eligible = (await appealableActions(pool, did)).find((a) => a.id === actionId)
  if (!eligible) return { ok: false, error: 'not_eligible' }
  const { rows } = await pool.query<{ id: number }>(
    'INSERT INTO appeals (did, action_id, statement) VALUES ($1, $2, $3) ON CONFLICT (action_id) DO NOTHING RETURNING id::int AS id',
    [did, actionId, text],
  )
  return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, error: 'duplicate' }
}
