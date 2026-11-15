import type pg from 'pg'
import { LOCK_MINUTES, SKIP_HOURS, type QueueName } from '@blueyvatar/core/moderation'
import { inTx } from './moderation'
import { ORDER_BY, QUEUE_WHERE, type Q } from './review-queue'

const lockFree = '(c.locked_by IS NULL OR c.locked_by = $2 OR c.locked_until < $3)'

/** Takes or renews the reviewer lock. Returns false when another reviewer holds a live lock. One reviewer per case at a time. */
export async function claimCase(q: Q, id: number, actor: string, now: Date = new Date()): Promise<boolean> {
  const until = new Date(now.getTime() + LOCK_MINUTES * 60_000)
  const { rowCount } = await q.query(
    `UPDATE review_cases c SET locked_by = $2, locked_until = $4 WHERE c.id = $1 AND ${lockFree}`,
    [id, actor, now, until],
  )
  return !!rowCount
}

export async function releaseCase(q: Q, id: number, actor: string): Promise<void> {
  await q.query('UPDATE review_cases SET locked_by = NULL, locked_until = NULL WHERE id = $1 AND locked_by = $2', [id, actor])
}

/** Releases the lock and keeps the case out of this reviewer's next picks for a few hours. */
export async function skipCase(q: Q, id: number, actor: string): Promise<void> {
  await releaseCase(q, id, actor)
  await q.query(
    'INSERT INTO case_skips (case_id, actor) VALUES ($1, $2) ON CONFLICT (case_id, actor) DO UPDATE SET skipped_at = now()',
    [id, actor],
  )
}

/**
 * Picks the next case in the queue for this reviewer and locks it: the case they already hold, otherwise the most severe
 * oldest case nobody holds that they have not skipped. Two reviewers never receive the same case.
 */
export async function nextCase(pool: pg.Pool, queue: QueueName, actor: string, now: Date = new Date()): Promise<number | null> {
  const skipSince = new Date(now.getTime() - SKIP_HOURS * 3_600_000)
  return inTx(pool, async (c) => {
    const { rows } = await c.query<{ id: number }>(
      `SELECT c.id::int AS id FROM review_cases c
        WHERE ${QUEUE_WHERE[queue]} AND ${lockFree} AND c.id > $1
          AND NOT EXISTS (SELECT 1 FROM case_skips k WHERE k.case_id = c.id AND k.actor = $2 AND k.skipped_at > $4)
        ORDER BY (c.locked_by = $2 AND c.locked_until >= $3) DESC NULLS LAST, ${ORDER_BY(queue)}
        LIMIT 1 FOR UPDATE OF c SKIP LOCKED`,
      [0, actor, now, skipSince],
    )
    const id = rows[0]?.id
    if (id === undefined) return null
    await claimCase(c, id, actor, now)
    return id
  })
}
