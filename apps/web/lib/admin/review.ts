import type pg from 'pg'
import {
  attachSignal, canViewChildSafety, citePolicy, LOCK_MINUTES, MAX_BLUR_PX, SEVERITIES, SKIP_HOURS, WELLNESS_DEFAULTS,
  type QueueName, type Severity, type SignalKind,
} from '@blueyvatar/core/moderation'
import { statementOfReasonsNotice, type Notice, type SorAction, type SorVars } from '@blueyvatar/core/verification'
import { blockAll, cleanReason, inTx, recordAction } from './moderation'
import { decideAppeal } from './appeals'
import type { Purge } from './purge'

type Q = Pick<pg.Pool, 'query'>
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

const QUEUE_WHERE: Record<QueueName, string> = {
  unreviewed: "c.status = 'unreviewed' AND NOT c.child_safety",
  escalated: "c.status = 'escalated' AND NOT c.child_safety",
  appeals: "c.status = 'appeal' AND NOT c.child_safety",
  resolved: "c.status = 'resolved'",
  child_safety: "c.status <> 'resolved' AND c.child_safety",
}
export const isQueue = (s: unknown): s is QueueName => typeof s === 'string' && s in QUEUE_WHERE

/** Severity first (Critical to Low), then the oldest case. The Resolved queue shows the latest first. */
const ORDER_BY = (queue: QueueName) => (queue === 'resolved' ? 'c.resolved_at DESC, c.id DESC' : `${SEV_ORDER}, c.opened_at, c.id`)

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

// ---------------------------------------------------------------- locks

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

// ---------------------------------------------------------------- case detail

export type SignalRow = { id: number; kind: SignalKind; category: string; source: string | null; report_id: number | null; created_at: Date }
export type ReportNote = { id: number; reason: string; source: string; details: string | null; created_at: Date }
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
      `SELECT r.id::int AS id, r.reason, r.source, r.details, r.created_at FROM reports r JOIN case_signals s ON s.report_id = r.id WHERE s.case_id = $1 ORDER BY r.created_at`, [id]),
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

// ---------------------------------------------------------------- wellness

export type Wellness = { blurPx: number; grayscale: boolean }
export async function getWellness(q: Q, did: string): Promise<Wellness> {
  const { rows } = await q.query<{ blur_px: number; grayscale: boolean }>('SELECT blur_px, grayscale FROM reviewer_prefs WHERE did = $1', [did])
  return rows[0] ? { blurPx: rows[0].blur_px, grayscale: rows[0].grayscale } : { ...WELLNESS_DEFAULTS }
}

export async function saveWellness(q: Q, did: string, w: { blurPx: unknown; grayscale: unknown }): Promise<Wellness> {
  const blur = Math.min(MAX_BLUR_PX, Math.max(0, Math.round(Number(w.blurPx))))
  const out = { blurPx: Number.isFinite(blur) ? blur : WELLNESS_DEFAULTS.blurPx, grayscale: w.grayscale === true || w.grayscale === 'on' }
  await q.query(
    `INSERT INTO reviewer_prefs (did, blur_px, grayscale) VALUES ($1, $2, $3)
     ON CONFLICT (did) DO UPDATE SET blur_px = EXCLUDED.blur_px, grayscale = EXCLUDED.grayscale, updated_at = now()`,
    [did, out.blurPx, out.grayscale],
  )
  return out
}

/** Writes a reveal to the audit log. Only the reviewer holding the case can reveal, and never in a child-safety case. */
export async function logReveal(pool: pg.Pool, actor: string, caseId: number, cid: string, now: Date = new Date()): Promise<boolean> {
  const c = await getCase(pool, caseId)
  if (!c || c.child_safety || c.locked_by !== actor || !c.locked_until || c.locked_until < now) return false
  await recordAction(pool, actor, 'reveal_image', { did: c.subject_did, cid, caseId, reason: 'Reviewer revealed the image' })
  return true
}

// ---------------------------------------------------------------- actions

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

