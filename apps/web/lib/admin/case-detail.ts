import type pg from 'pg'
import type { SignalKind } from '@blueyvatar/core/moderation'
import { getCase, type CaseRow, type Q } from './review-queue'

export type SignalRow = { id: number; kind: SignalKind; category: string; source: string | null; report_id: number | null; created_at: Date }
export type ReportNote = { id: number; reason: string; source: string; details: string | null; reporter_did: string | null; created_at: Date }
export type CaseDetail = {
  c: CaseRow
  signals: SignalRow[]
  /** Free-text details from reports. Left out of child-safety cases, which show metadata only. The reporter's contact and IP hash are never read. */
  reportNotes: ReportNote[]
  otherCases: { id: number; status: string; severity: string; opened_at: Date; resolved_at: Date | null }[]
  sameHash: { accounts: number; cases: { id: number; subject_did: string; status: string }[]; blocks: number; actions: number }
  images: { cid: string; rkey: string; rating: string; is_default: boolean }[]
  blocked: { cid: string; kind: string; blocked_at: Date }[]
  overrides: { cid: string; rating: string; prior_rating: string }[]
  suspension: { reason: string; suspended_at: Date } | null
  events: { id: number; actor: string; action: string; reason: string | null; policy: string | null; created_at: Date; target_cid: string | null; notice_template: string | null; notice_result: string | null; detail: unknown }[]
  appeal: { id: number; statement: string; action: string; action_id: number; action_reason: string | null; action_by: string } | null
  accountActions: number
}

export async function caseDetail(q: Q, id: number): Promise<CaseDetail | null> {
  const c = await getCase(q, id)
  if (!c) return null
  const did = c.subject_did
  const one = async <T extends pg.QueryResultRow>(sql: string, params: unknown[]) => (await q.query<T>(sql, params)).rows
  const [signals, notes, other, hashCases, hashBlocks, hashActions, hashAccts, images, blocked, overrides, susp, events, appeal, acts] = await Promise.all([
    one<SignalRow>('SELECT id::int AS id, kind, category, source, report_id::int AS report_id, created_at FROM case_signals WHERE case_id = $1 ORDER BY created_at, id', [id]),
    c.child_safety ? Promise.resolve([] as ReportNote[]) : one<ReportNote>(
      `SELECT r.id::int AS id, r.reason, r.source, r.details, r.reporter_did, r.created_at FROM reports r JOIN case_signals s ON s.report_id = r.id WHERE s.case_id = $1 ORDER BY r.created_at`, [id]),
    one<CaseDetail['otherCases'][number]>('SELECT id::int AS id, status, severity, opened_at, resolved_at FROM review_cases WHERE subject_did = $1 AND id <> $2 ORDER BY opened_at DESC LIMIT 20', [did, id]),
    c.subject_cid ? one<{ id: number; subject_did: string; status: string }>('SELECT id::int AS id, subject_did, status FROM review_cases WHERE subject_cid = $1 AND id <> $2 ORDER BY opened_at DESC LIMIT 20', [c.subject_cid, id]) : Promise.resolve([]),
    c.subject_cid ? one<{ n: number }>('SELECT count(*)::int AS n FROM blocked_images WHERE cid = $1', [c.subject_cid]) : Promise.resolve([{ n: 0 }]),
    c.subject_cid ? one<{ n: number }>('SELECT count(*)::int AS n FROM admin_actions WHERE target_cid = $1', [c.subject_cid]) : Promise.resolve([{ n: 0 }]),
    c.subject_cid ? one<{ n: number }>('SELECT count(DISTINCT did)::int AS n FROM images WHERE cid = $1', [c.subject_cid]) : Promise.resolve([{ n: 0 }]),
    one<CaseDetail['images'][number]>('SELECT cid, rkey, rating, is_default FROM images WHERE did = $1 ORDER BY is_default DESC, created_at DESC LIMIT 12', [did]),
    one<CaseDetail['blocked'][number]>('SELECT cid, kind, blocked_at FROM blocked_images WHERE did = $1 AND unblocked_at IS NULL ORDER BY blocked_at DESC', [did]),
    one<CaseDetail['overrides'][number]>('SELECT cid, rating, prior_rating FROM rating_overrides WHERE did = $1 AND lifted_at IS NULL', [did]),
    one<NonNullable<CaseDetail['suspension']>>('SELECT reason, suspended_at FROM account_suspensions WHERE did = $1 AND lifted_at IS NULL', [did]),
    one<CaseDetail['events'][number]>('SELECT id::int AS id, actor, action, reason, policy, created_at, target_cid, notice_template, notice_result, detail FROM admin_actions WHERE case_id = $1 ORDER BY id DESC LIMIT 100', [id]),
    one<NonNullable<CaseDetail['appeal']>>(
      `SELECT p.id::int AS id, p.statement, a.action, p.action_id::int AS action_id, a.reason AS action_reason, a.actor AS action_by
         FROM case_signals s JOIN appeals p ON p.id = s.appeal_id JOIN admin_actions a ON a.id = p.action_id WHERE s.case_id = $1`, [id]),
    one<{ n: number }>('SELECT count(*)::int AS n FROM admin_actions WHERE target_did = $1', [did]),
  ])
  return {
    c, signals, reportNotes: notes, otherCases: other,
    sameHash: { accounts: hashAccts[0]?.n ?? 0, cases: hashCases, blocks: hashBlocks[0]?.n ?? 0, actions: hashActions[0]?.n ?? 0 },
    images, blocked, overrides, suspension: susp[0] ?? null, events, appeal: appeal[0] ?? null, accountActions: acts[0]?.n ?? 0,
  }
}
