import type pg from 'pg'
import { attachSignal, SEVERITIES, type QueueName, type Severity } from '@blueyvatar/core/moderation'

export type Q = Pick<pg.Pool, 'query'>
const SEV_ORDER = `array_position(ARRAY[${SEVERITIES.map((s) => `'${s}'`).join(', ')}], c.severity)`

export type CaseRow = {
  id: number; dedupe_key: string; subject_did: string; subject_cid: string | null; status: 'unreviewed' | 'escalated' | 'appeal' | 'resolved'
  severity: Severity; child_safety: boolean; diverted_at: Date | null; tags: string[]; opened_at: Date; first_action_at: Date | null
  resolved_at: Date | null; resolved_by: string | null; locked_by: string | null; locked_until: Date | null
  report_count: number; categories: string[]
}

const CASE_COLS = `c.id::int AS id, c.dedupe_key, c.subject_did, c.subject_cid, c.status, c.severity, c.child_safety, c.diverted_at, c.tags, c.opened_at,
  c.first_action_at, c.resolved_at, c.resolved_by, c.locked_by, c.locked_until,
  (SELECT count(*)::int FROM case_signals s WHERE s.case_id = c.id AND s.kind = 'report') AS report_count,
  COALESCE((SELECT array_agg(DISTINCT s.category ORDER BY s.category) FROM case_signals s WHERE s.case_id = c.id), '{}') AS categories`

export const QUEUE_WHERE: Record<QueueName, string> = {
  unreviewed: "c.status = 'unreviewed' AND NOT c.child_safety",
  escalated: "c.status = 'escalated' AND NOT c.child_safety",
  appeals: "c.status = 'appeal' AND NOT c.child_safety",
  resolved: "c.status = 'resolved'",
  child_safety: "c.status <> 'resolved' AND c.child_safety",
}
export const isQueue = (s: unknown): s is QueueName => typeof s === 'string' && s in QUEUE_WHERE

/** Severity first (Critical to Low), then the oldest case. The Resolved queue shows the latest first. */
export const ORDER_BY = (queue: QueueName) => (queue === 'resolved' ? 'c.resolved_at DESC, c.id DESC' : `${SEV_ORDER}, c.opened_at, c.id`)

export async function listCases(q: Q, queue: QueueName, limit = 100): Promise<CaseRow[]> {
  const { rows } = await q.query<CaseRow>(`SELECT ${CASE_COLS} FROM review_cases c WHERE ${QUEUE_WHERE[queue]} ORDER BY ${ORDER_BY(queue)} LIMIT $1`, [limit])
  return rows
}

export async function queueCounts(q: Q): Promise<Record<QueueName, number>> {
  const out = {} as Record<QueueName, number>
  for (const name of Object.keys(QUEUE_WHERE) as QueueName[]) {
    out[name] = (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM review_cases c WHERE ${QUEUE_WHERE[name]}`)).rows[0]?.n ?? 0
  }
  return out
}

export async function getCase(q: Q, id: number): Promise<CaseRow | null> {
  const { rows } = await q.query<CaseRow>(`SELECT ${CASE_COLS} FROM review_cases c WHERE c.id = $1`, [id])
  return rows[0] ?? null
}

/** Opens a case by hand for an account (from the account page). Reuses the open case when there is one. */
export async function openManualCase(pool: pg.Pool, did: string): Promise<number> {
  return (await attachSignal(pool, { did, kind: 'manual', category: 'manual' })).caseId
}
