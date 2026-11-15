import type pg from 'pg'
import { canViewChildSafety, citePolicy } from '@blueyvatar/core/moderation'
import { statementOfReasonsNotice, type Notice, type SorAction, type SorVars } from '@blueyvatar/core/verification'
import { blockAll, cleanReason, inTx, recordAction } from './moderation'
import { decideAppeal } from './appeals'
import { caseDetail, type CaseDetail } from './case-detail'
import type { Purge } from './purge'
import type { CaseRow, Q } from './review-queue'

export const CASE_ACTIONS = ['acknowledge', 'remove_image', 'rating_change', 'warn', 'suspend', 'escalate', 'reverse', 'comment', 'tag', 'divert', 'uphold', 'overturn'] as const
export type CaseAction = (typeof CASE_ACTIONS)[number]
export const ACTION_LABELS: Record<CaseAction, string> = {
  acknowledge: 'Acknowledge or dismiss', remove_image: 'Remove image', rating_change: 'Apply rating change', warn: 'Warn', suspend: 'Suspend account',
  escalate: 'Escalate', reverse: 'Reverse an action', comment: 'Comment', tag: 'Tag', divert: 'Divert (remove from serving)', uphold: 'Uphold decision', overturn: 'Overturn decision',
}

/** Which actions each kind of case allows. Child-safety cases allow only divert and comment, and closing once diverted. */
export function allowedActions(c: Pick<CaseRow, 'status' | 'child_safety' | 'diverted_at'>): CaseAction[] {
  if (c.child_safety) return c.status === 'resolved' ? [] : c.diverted_at ? ['comment', 'tag', 'acknowledge'] : ['divert', 'comment', 'tag']
  if (c.status === 'resolved') return ['reverse', 'comment', 'tag']
  if (c.status === 'appeal') return ['uphold', 'overturn', 'comment', 'tag']
  return ['acknowledge', 'remove_image', 'rating_change', 'warn', 'suspend', 'escalate', 'reverse', 'comment', 'tag']
}

const NOTICE_FOR: Partial<Record<CaseAction, SorAction>> = { remove_image: 'remove_image', suspend: 'suspend', warn: 'warn', rating_change: 'rating_change', reverse: 'reverse' }
const RATINGS = ['g', 'pg', 'r', 'x']
const CID_RE = /^[A-Za-z0-9]{10,200}$/

export type ActionInput = {
  caseId: number
  action: CaseAction
  reason: unknown
  /** A policy id from the configured list. */
  policy: unknown
  /** remove_image: 'image' or 'account'. */
  scope?: string
  cid?: string
  rating?: string
  tag?: string
  /** reverse: 'suspension', 'block:<cid>', or 'rating:<cid>'. */
  what?: string
  /** Notice fields the reviewer writes for the account owner. */
  facts?: string
  explanation?: string
  /** escalate: send to the restricted child-safety queue. */
  childSafety?: boolean
}

export type ActionOutcome =
  | { ok: false; error: string }
  | { ok: true; message: string; purge: { did: string; cids: string[] } | null; notice: { did: string; template: string; notice: Notice } | null; reportIds: number[]; resolved: boolean; reportOutcome: 'actioned' | 'dismissed'; actionId: number; appeal?: { did: string; appealId: number; outcome: 'upheld' | 'overturned' } }

export type NoticeContext = { publicUrl: string; env?: Record<string, string | undefined>; now?: Date }

const DURATION: Record<string, string> = {
  remove_image: 'Indefinite, until a reviewer reverses it or an appeal succeeds',
  suspend: 'Indefinite, until a reviewer lifts it or an appeal succeeds',
  warn: 'Not applicable: no restriction was applied',
  rating_change: 'Indefinite, until a reviewer changes it back or an appeal succeeds',
}

/** Fields the notice shows that come from the case, not from the reviewer. */
export function noticeVars(d: Pick<CaseDetail, 'signals' | 'c'>, input: ActionInput, policy: { label: string }, publicUrl: string, scope: string): SorVars {
  const reports = d.signals.filter((s) => s.kind === 'report').length
  const auto = [...new Set(d.signals.filter((s) => s.kind === 'scanner' || s.kind === 'label').map((s) => s.source ?? s.kind))]
  const source = [
    reports ? `A notice from ${reports === 1 ? 'a user' : `${reports} users`}` : '',
    auto.length ? 'Our own initiative, after an automated check flagged it' : '',
    !reports && !auto.length ? 'Our own initiative' : '',
  ].filter(Boolean).join('; ')
  return {
    scope, duration: DURATION[input.action] ?? 'Not applicable', facts: input.facts, source,
    automated: auto.length
      ? `Yes. An automated check (${auto.join(', ')}) flagged the content. A person reviewed it and made this decision.`
      : 'No. Nothing was detected or decided automatically. A person reviewed the content and made this decision.',
    policy: policy.label, policy_url: `${publicUrl.replace(/\/+$/, '')}/policy`, explanation: input.explanation,
    appeal_link: `${publicUrl.replace(/\/+$/, '')}/account/appeal`,
  }
}

function scopeText(input: ActionInput, c: CaseRow, cid: string | null): string {
  if (input.action === 'suspend') return 'your account'
  if (input.action === 'reverse') return input.what === 'suspension' ? 'your account suspension' : input.what?.startsWith('rating:') ? 'an image rating change' : 'a removed image'
  if (input.action === 'rating_change') return `the image ${cid} (rating set to ${input.rating?.toUpperCase()})`
  if (input.action === 'warn') return cid ? `the image ${cid}` : 'content on your account'
  return input.scope === 'image' && cid ? `the image ${cid}` : c.subject_cid && input.scope !== 'account' ? `the image ${c.subject_cid}` : 'all images of your account'
}

/**
 * Runs one reviewer action on a case. Every action needs a reason and a policy from the configured list, and the reviewer must
 * hold the case lock. State changes and the audit row are written in one transaction. For actions that tell the owner, the
 * statement of reasons is built and checked first: an unfilled placeholder stops the action before anything changes.
 * Cache purges and sending happen after the transaction (the caller does them with the returned outcome).
 */
export async function performCaseAction(pool: pg.Pool, actor: string, input: ActionInput, ctx: NoticeContext, purgeFn: Purge): Promise<ActionOutcome> {
  const env = ctx.env ?? process.env
  const now = ctx.now ?? new Date()
  const reason = cleanReason(input.reason)
  if (!reason) return { ok: false, error: 'Enter a reason (up to 500 characters).' }
  const policy = citePolicy(input.policy, env)
  if (!policy) return { ok: false, error: 'Choose the policy this decision cites.' }
  const detail0 = await caseDetail(pool, input.caseId)
  if (!detail0) return { ok: false, error: 'Case not found.' }
  const c0 = detail0.c
  if (c0.child_safety && !canViewChildSafety(actor, env)) return { ok: false, error: 'Only the child-safety reviewers can act on this case.' }
  if (!allowedActions(c0).includes(input.action)) return { ok: false, error: `${ACTION_LABELS[input.action]} is not available for this case.` }

  // Inputs and the owner notice are checked before any change.
  const cid = input.cid && CID_RE.test(input.cid) ? input.cid : c0.subject_cid
  if (input.action === 'rating_change') {
    if (!input.rating || !RATINGS.includes(input.rating)) return { ok: false, error: 'Choose a rating.' }
    if (!cid || !detail0.images.some((i) => i.cid === cid)) return { ok: false, error: 'Choose an indexed image of this account.' }
  }
  if (input.action === 'remove_image' && input.scope === 'image' && !cid) return { ok: false, error: 'This case has no single image. Remove all images or open a case on the image.' }
  let tag = ''
  if (input.action === 'tag') {
    tag = String(input.tag ?? '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(tag)) return { ok: false, error: 'A tag is lowercase letters, digits, and hyphens, up to 31 characters.' }
  }
  const noticeAction = NOTICE_FOR[input.action]
  let notice: { template: string; notice: Notice } | null = null
  if (noticeAction) {
    const check = statementOfReasonsNotice({ did: c0.subject_did, action: noticeAction, vars: noticeVars(detail0, input, policy, ctx.publicUrl, scopeText(input, c0, cid)), publicUrl: ctx.publicUrl })
    if (!check.ok) return { ok: false, error: `The notice to the account owner is not complete: fill in ${check.missing.join(', ')}. Nothing was changed.` }
  }

  if (input.action === 'uphold' || input.action === 'overturn') {
    const appealId = detail0.appeal?.id
    if (!appealId) return { ok: false, error: 'This case has no appeal.' }
    if (c0.locked_by !== actor || !c0.locked_until || c0.locked_until < now) return { ok: false, error: lockMessage(c0, actor, now) }
    const outcome = input.action === 'uphold' ? 'upheld' : 'overturned'
    const r = await decideAppeal(pool, purgeFn, actor, appealId, outcome, reason, { caseId: c0.id, policy: policy.id })
    if (!r.ok) return r
    await finishCase(pool, c0.id, actor, now)
    return { ok: true, message: `Appeal ${appealId} ${outcome}.`, purge: null, notice: null, reportIds: [], resolved: true, reportOutcome: 'actioned', actionId: 0, appeal: { did: r.did, appealId, outcome } }
  }

  const done = await inTx(pool, async (c) => {
    const cs = (await c.query<CaseRow>('SELECT id::int AS id, status, subject_did, subject_cid, locked_by, locked_until, child_safety, diverted_at FROM review_cases WHERE id = $1 FOR UPDATE', [input.caseId])).rows[0]
    if (!cs) return { error: 'Case not found.' } as const
    if (cs.locked_by !== actor || !cs.locked_until || cs.locked_until < now) return { error: lockMessage(cs, actor, now) } as const
    const did = cs.subject_did
    const meta = { caseId: cs.id, policy: policy.id }
    let cids: string[] = []
    let actionId = 0
    let resolves = false
    let toStatus: CaseRow['status'] | null = null
    let reportOutcome: 'actioned' | 'dismissed' = 'actioned'
    let detail: Record<string, unknown> = {}
    let childFlag = false

    switch (input.action) {
      case 'acknowledge':
        resolves = true; reportOutcome = 'dismissed'
        actionId = await recordAction(c, actor, 'acknowledge', { did, cid: cs.subject_cid, reason, ...meta })
        break
      case 'comment':
        actionId = await recordAction(c, actor, 'comment', { did, cid: cs.subject_cid, reason, ...meta })
        break
      case 'tag':
        await c.query('UPDATE review_cases SET tags = (SELECT array_agg(DISTINCT t) FROM unnest(tags || $2::text) t) WHERE id = $1', [cs.id, tag])
        actionId = await recordAction(c, actor, 'tag', { did, cid: cs.subject_cid, reason, detail: { tag }, ...meta })
        break
      case 'escalate':
        toStatus = 'escalated'; childFlag = input.childSafety === true; detail = { childSafety: childFlag }
        actionId = await recordAction(c, actor, 'escalate', { did, cid: cs.subject_cid, reason, detail, ...meta })
        if (childFlag) cids = await divertImages(c, did, cs.subject_cid, reason, actor)
        break
      case 'divert':
        cids = await divertImages(c, did, cs.subject_cid, reason, actor)
        await c.query('UPDATE review_cases SET diverted_at = $2 WHERE id = $1', [cs.id, now])
        detail = { images: cids.length }
        actionId = await recordAction(c, actor, 'divert', { did, cid: cs.subject_cid, reason, detail, ...meta })
        break
      case 'remove_image': {
        resolves = true
        if (input.scope === 'image' && cid) {
          await blockOne(c, did, cid, reason, actor)
          cids = [cid]
          actionId = await recordAction(c, actor, 'block_image', { did, cid, reason, ...meta })
        } else {
          cids = await blockAll(c, did, reason, actor, 'takedown')
          actionId = await recordAction(c, actor, 'takedown', { did, reason, detail: { images: cids.length }, ...meta })
        }
        break
      }
      case 'rating_change': {
        resolves = true
        const cur = (await c.query<{ rating: string }>('SELECT rating FROM images WHERE did = $1 AND cid = $2 LIMIT 1', [did, cid])).rows[0]
        if (!cur) return { error: 'That image is not indexed.' } as const
        await c.query(
          `INSERT INTO rating_overrides (did, cid, rating, prior_rating, set_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (did, cid) DO UPDATE SET rating = EXCLUDED.rating, set_by = EXCLUDED.set_by, set_at = now(),
             prior_rating = CASE WHEN rating_overrides.lifted_at IS NULL THEN rating_overrides.prior_rating ELSE EXCLUDED.prior_rating END, lifted_at = NULL`,
          [did, cid, input.rating, cur.rating, actor],
        )
        await c.query('UPDATE images SET rating = $3 WHERE did = $1 AND cid = $2', [did, cid, input.rating])
        cids = [cid!]
        detail = { from: cur.rating, to: input.rating }
        actionId = await recordAction(c, actor, 'rating_change', { did, cid, reason, detail, ...meta })
        break
      }
      case 'warn':
        resolves = true
        actionId = await recordAction(c, actor, 'warn', { did, cid: cs.subject_cid, reason, ...meta })
        break
      case 'suspend': {
        resolves = true
        const ins = await c.query(
          `INSERT INTO account_suspensions (did, reason, suspended_by) VALUES ($1, $2, $3)
           ON CONFLICT (did) DO UPDATE SET reason = EXCLUDED.reason, suspended_by = EXCLUDED.suspended_by, suspended_at = now(), lifted_at = NULL, lifted_by = NULL
           WHERE account_suspensions.lifted_at IS NOT NULL`,
          [did, reason, actor],
        )
        if (!ins.rowCount) return { error: 'Account is already suspended.' } as const
        cids = await blockAll(c, did, reason, actor, 'suspension')
        actionId = await recordAction(c, actor, 'suspend', { did, reason, ...meta })
        break
      }
      case 'reverse': {
        const what = String(input.what ?? '')
        if (what === 'suspension') {
          const lifted = await c.query('UPDATE account_suspensions SET lifted_at = now(), lifted_by = $2 WHERE did = $1 AND lifted_at IS NULL', [did, actor])
          if (!lifted.rowCount) return { error: 'Account is not suspended.' } as const
          const r = await c.query<{ cid: string }>("UPDATE blocked_images SET unblocked_at = now() WHERE did = $1 AND kind = 'suspension' AND unblocked_at IS NULL RETURNING cid", [did])
          cids = r.rows.map((x) => x.cid)
        } else if (what.startsWith('block:') && CID_RE.test(what.slice(6))) {
          const r = await c.query('UPDATE blocked_images SET unblocked_at = now() WHERE did = $1 AND cid = $2 AND unblocked_at IS NULL', [did, what.slice(6)])
          if (!r.rowCount) return { error: 'No active block for that image.' } as const
          cids = [what.slice(6)]
        } else if (what.startsWith('rating:') && CID_RE.test(what.slice(7))) {
          const r = await c.query<{ prior_rating: string }>('UPDATE rating_overrides SET lifted_at = now() WHERE did = $1 AND cid = $2 AND lifted_at IS NULL RETURNING prior_rating', [did, what.slice(7)])
          if (!r.rows[0]) return { error: 'No active rating change for that image.' } as const
          await c.query('UPDATE images SET rating = $3 WHERE did = $1 AND cid = $2', [did, what.slice(7), r.rows[0].prior_rating])
          cids = [what.slice(7)]
        } else return { error: 'Choose what to reverse.' } as const
        detail = { what }
        actionId = await recordAction(c, actor, 'reverse', { did, cid: cids[0] ?? null, reason, detail, ...meta })
        break
      }
      default:
        return { error: 'Unknown action.' } as const
    }

    await c.query(
      `UPDATE review_cases SET first_action_at = COALESCE(first_action_at, $2),
          status = COALESCE($3, status), child_safety = child_safety OR $4,
          severity = CASE WHEN $4 THEN 'critical' ELSE severity END,
          locked_by = CASE WHEN $3 IS NOT NULL THEN NULL ELSE locked_by END, locked_until = CASE WHEN $3 IS NOT NULL THEN NULL ELSE locked_until END
        WHERE id = $1`,
      [cs.id, now, toStatus, childFlag],
    )
    let reportIds: number[] = []
    if (resolves) {
      reportIds = await resolveInTx(c, cs.id, actor, reason, reportOutcome, now)
    }
    return { did, cids, actionId, reportIds, resolves, reportOutcome, status: toStatus } as const
  })
  if ('error' in done) return { ok: false, error: String(done.error) }

  const message = `${ACTION_LABELS[input.action]} recorded.`
  if (noticeAction) {
    const built = statementOfReasonsNotice({
      did: done.did, action: noticeAction, publicUrl: ctx.publicUrl,
      vars: { ...noticeVars(detail0, input, policy, ctx.publicUrl, scopeText(input, c0, cid)), appeal_link: `${ctx.publicUrl.replace(/\/+$/, '')}/account/appeal?action=${done.actionId}` },
    })
    if (built.ok) notice = { template: built.template, notice: built.notice }
  }
  return {
    ok: true, message, purge: done.cids.length ? { did: done.did, cids: done.cids } : null,
    notice: notice ? { did: done.did, ...notice } : null, reportIds: done.reportIds, resolved: done.resolves, reportOutcome: done.reportOutcome, actionId: done.actionId,
  }
}

const lockMessage = (c: Pick<CaseRow, 'locked_by' | 'locked_until'>, actor: string, now: Date) =>
  c.locked_by && c.locked_by !== actor && c.locked_until && c.locked_until >= now
    ? `${c.locked_by} is working on this case.`
    : 'You no longer hold this case. Open it again to take it back.'

async function blockOne(c: Q, did: string, cid: string, reason: string, by: string): Promise<void> {
  await c.query(
    `INSERT INTO blocked_images (did, cid, reason, blocked_by, kind) VALUES ($1, $2, $3, $4, 'takedown')
     ON CONFLICT (did, cid) DO UPDATE SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by, blocked_at = now(), unblocked_at = NULL, kind = 'takedown'`,
    [did, cid, reason, by],
  )
}

/** Takes the image (or all of the account's images) out of serving. */
async function divertImages(c: Q, did: string, cid: string | null, reason: string, by: string): Promise<string[]> {
  if (cid) { await blockOne(c, did, cid, reason, by); return [cid] }
  return blockAll(c, did, reason, by, 'takedown')
}

async function resolveInTx(c: Q, caseId: number, actor: string, reason: string, outcome: 'actioned' | 'dismissed', now: Date): Promise<number[]> {
  await c.query("UPDATE review_cases SET status = 'resolved', resolved_at = $2, resolved_by = $3, locked_by = NULL, locked_until = NULL WHERE id = $1", [caseId, now, actor])
  const { rows } = await c.query<{ id: number }>(
    `UPDATE reports SET status = $2, actioned_by = $3, action_reason = $4, actioned_at = $5
      WHERE status = 'open' AND id IN (SELECT report_id FROM case_signals WHERE case_id = $1 AND report_id IS NOT NULL) RETURNING id::int AS id`,
    [caseId, outcome, actor, reason, now],
  )
  return rows.map((r) => r.id)
}

async function finishCase(q: Q, caseId: number, actor: string, now: Date): Promise<void> {
  await q.query("UPDATE review_cases SET status = 'resolved', resolved_at = $2, resolved_by = $3, first_action_at = COALESCE(first_action_at, $2), locked_by = NULL, locked_until = NULL WHERE id = $1", [caseId, now, actor])
}

/** Writes the 'notice_sent' audit row after a send attempt. The row names the template and result, never the text. */
export async function recordNotice(q: Q, actor: string, caseId: number, did: string, template: string, result: string): Promise<void> {
  await recordAction(q, actor, 'notice_sent', { did, caseId, reason: 'Statement of reasons sent to the account owner', noticeTemplate: template, noticeResult: result })
}
