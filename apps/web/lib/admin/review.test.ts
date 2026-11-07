import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { attachSignal, moderationMetrics, slaHours, syncCases } from '@blueyvatar/core/moderation'
import { appealableActions, submitAppeal } from '../appeals'
import { allowedActions, caseDetail, claimCase, getCase, getWellness, listCases, logReveal, nextCase, performCaseAction, queueCounts, releaseCase, saveWellness, skipCase, type ActionInput } from './review'

const url = process.env.TEST_DATABASE_URL
const schema = `t_review_${process.pid}_${Date.now()}`
const sql = (f: string) => readFileSync(new URL(`../../../../db/migrations/${f}`, import.meta.url), 'utf8')
const PUBLIC_URL = 'https://blueyvatar.test'
const ctx = { publicUrl: PUBLIC_URL, env: {} as Record<string, string | undefined> }
const A = 'did:plc:reviewera'
const B = 'did:plc:reviewerb'
const purge = vi.fn(async () => true)

describe.skipIf(!url)('review portal', () => {
  let pool: pg.Pool
  let n = 0
  const did = () => `did:plc:subject${++n}`
  const cid = () => `bafycid${String(++n).padStart(10, '0')}`
  const T0 = new Date('2026-11-01T00:00:00Z')
  const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000)
  const sig = (d: string, category: string, extra: Partial<Parameters<typeof attachSignal>[1]> = {}) => attachSignal(pool, { did: d, kind: 'report', category, at: T0, ...extra })
  const act = (caseId: number, action: ActionInput['action'], extra: Partial<ActionInput> = {}, actor = A) =>
    performCaseAction(pool, actor, { caseId, action, reason: 'because', policy: 'illegal-content', facts: 'Two reports and a review.', explanation: 'It breaks the policy.', ...extra }, { ...ctx, now: T0 }, purge)
  const image = (d: string, c: string, rating = 'g') => pool.query("INSERT INTO images (did, rkey, cid, mime_type, rating, created_at) VALUES ($1, $2, $3, 'image/png', $4, now())", [d, `r${++n}`, c, rating])
  const report = async (d: string, reason: string, at = T0) =>
    Number((await pool.query("INSERT INTO reports (target_did, source, reason, ip_hash, reporter_contact, created_at) VALUES ($1, 'avatar', $2, 'h', 'secret@x.test', $3) RETURNING id", [d, reason, at])).rows[0].id)

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const f of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter((x) => x.endsWith('.sql')).sort()) await pool.query(sql(f))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('orders a queue by severity, then oldest', async () => {
    const mk = async (category: string, at: Date) => (await attachSignal(pool, { did: did(), kind: 'report', category, at })).caseId
    const lowOld = await mk('spam', hours(1))
    const modOld = await mk('harassment', hours(2))
    const highNew = await mk('illegal', hours(30))
    const highOld = await mk('illegal', hours(3))
    const modNew = await mk('copyright', hours(40))
    const label = (await attachSignal(pool, { did: did(), kind: 'label', category: 'porn', source: 'labeler.test', at: hours(50) })).caseId
    const mine = new Set([lowOld, modOld, highNew, highOld, modNew, label])
    const order = (await listCases(pool, 'unreviewed', 500)).map((c) => c.id).filter((id) => mine.has(id))
    expect(order).toEqual([highOld, highNew, label, modOld, modNew, lowOld])
  })

  it('dedupes by image CID and account DID into one case', async () => {
    const d = did()
    const c1 = await sig(d, 'spam')
    const c2 = await sig(d, 'harassment', { at: hours(1) })
    expect(c2).toEqual({ caseId: c1.caseId, created: false })
    let det = await getCase(pool, c1.caseId)
    expect(det).toMatchObject({ report_count: 2, severity: 'moderate', subject_cid: null })
    // The first image-level signal joins the open account case and makes it the case for that image.
    const img = cid()
    const c3 = await attachSignal(pool, { did: d, cid: img, kind: 'scanner', category: 'explicit', source: 'svc', at: hours(2) })
    expect(c3.caseId).toBe(c1.caseId)
    det = await getCase(pool, c1.caseId)
    expect(det).toMatchObject({ subject_cid: img, severity: 'high', dedupe_key: `cid:${img}` })
    expect((await attachSignal(pool, { did: d, cid: img, kind: 'label', category: 'porn', source: 'l', at: hours(3) })).caseId).toBe(c1.caseId)
    // A different image of the same account is its own case, and so is the same account once the case is resolved.
    const other = await attachSignal(pool, { did: d, cid: cid(), kind: 'label', category: 'porn', at: hours(3) })
    expect(other.caseId).not.toBe(c1.caseId)
    expect(other.created).toBe(true)
    await pool.query("UPDATE review_cases SET status = 'resolved' WHERE id = $1", [c1.caseId])
    expect((await attachSignal(pool, { did: d, cid: img, kind: 'label', category: 'porn', at: hours(9) })).caseId).not.toBe(c1.caseId)
  })

  it('opens cases from reports and appeals once, hides reporter identity, and dedupes repeats', async () => {
    const d = did()
    const r1 = await report(d, 'spam')
    const r2 = await report(d, 'illegal')
    expect(await syncCases(pool)).toMatchObject({ reports: expect.any(Number) })
    expect(await syncCases(pool)).toEqual({ reports: 0, appeals: 0 })
    const rows = (await pool.query('SELECT case_id FROM case_signals WHERE report_id = ANY($1)', [[r1, r2]])).rows
    expect(new Set(rows.map((r) => r.case_id)).size).toBe(1)
    const detail = await caseDetail(pool, rows[0].case_id)
    expect(detail?.c).toMatchObject({ report_count: 2, severity: 'high' })
    expect(JSON.stringify(detail)).not.toContain('secret@x.test')
  })

  it('gives each case to one reviewer at a time', async () => {
    const id = (await sig(did(), 'illegal')).caseId
    const t = new Date('2026-11-02T00:00:00Z')
    expect(await claimCase(pool, id, A, t)).toBe(true)
    expect(await claimCase(pool, id, B, new Date(t.getTime() + 60_000))).toBe(false)
    expect(await claimCase(pool, id, A, new Date(t.getTime() + 60_000))).toBe(true)
    expect(await claimCase(pool, id, B, new Date(t.getTime() + 60 * 60_000))).toBe(true)
    expect((await getCase(pool, id))?.locked_by).toBe(B)
    await releaseCase(pool, id, A)
    expect((await getCase(pool, id))?.locked_by).toBe(B)
    await releaseCase(pool, id, B)
    expect((await getCase(pool, id))?.locked_by).toBeNull()
  })

  it('never hands the same case to two reviewers, resumes your own, and honors skip', async () => {
    await pool.query("UPDATE review_cases SET status = 'resolved' WHERE status = 'unreviewed'")
    const a = (await sig(did(), 'illegal')).caseId
    const b = (await sig(did(), 'spam', { at: hours(5) })).caseId
    const now = new Date()
    const [x, y] = await Promise.all([nextCase(pool, 'unreviewed', A, now), nextCase(pool, 'unreviewed', B, now)])
    expect(new Set([x, y])).toEqual(new Set([a, b]))
    expect(x).toBe(a)
    expect(await nextCase(pool, 'unreviewed', A, now)).toBe(a)
    expect(await nextCase(pool, 'unreviewed', 'did:plc:third', now)).toBeNull()
    await skipCase(pool, a, A)
    expect(await nextCase(pool, 'unreviewed', A, now)).toBeNull()
    expect(await nextCase(pool, 'unreviewed', B, now)).toBe(b)
    await releaseCase(pool, b, B)
    expect(await nextCase(pool, 'unreviewed', B, now)).toBe(a)
  })

  it('requires a reason, a configured policy, and the lock', async () => {
    const d = did()
    const id = (await sig(d, 'spam')).caseId
    await claimCase(pool, id, A, T0)
    const before = (await pool.query('SELECT count(*)::int AS n FROM admin_actions')).rows[0].n
    expect(await act(id, 'acknowledge', { reason: '  ' })).toEqual({ ok: false, error: expect.stringContaining('reason') })
    expect(await act(id, 'acknowledge', { reason: 'x'.repeat(501) })).toMatchObject({ ok: false })
    expect(await act(id, 'acknowledge', { policy: '' })).toEqual({ ok: false, error: expect.stringContaining('policy') })
    expect(await act(id, 'acknowledge', { policy: 'not-a-policy' })).toMatchObject({ ok: false })
    expect(await act(id, 'comment', { policy: undefined })).toMatchObject({ ok: false })
    expect(await act(id, 'acknowledge', {}, B)).toEqual({ ok: false, error: expect.stringContaining(A) })
    expect((await pool.query('SELECT count(*)::int AS n FROM admin_actions')).rows[0].n).toBe(before)
    expect((await getCase(pool, id))?.status).toBe('unreviewed')
  })

  it('blocks an action whose notice has an unfilled field, changing nothing', async () => {
    const d = did()
    const img = cid()
    await image(d, img)
    const id = (await sig(d, 'illegal', { cid: img })).caseId
    await claimCase(pool, id, A, T0)
    for (const extra of [{ facts: '' }, { explanation: '   ' }, { facts: 'see {{facts}}' }]) {
      const r = await act(id, 'remove_image', { scope: 'image', ...extra })
      expect(r).toEqual({ ok: false, error: expect.stringContaining('Nothing was changed') })
    }
    expect((await pool.query('SELECT 1 FROM blocked_images WHERE did = $1', [d])).rowCount).toBe(0)
    expect((await getCase(pool, id))?.status).toBe('unreviewed')
  })

  it('removes an image: blocks it, audits with case and policy, resolves reports, and builds a complete notice', async () => {
    const d = did()
    const img = cid()
    await image(d, img)
    const rid = await report(d, 'illegal')
    await syncCases(pool)
    const id = (await pool.query('SELECT case_id FROM case_signals WHERE report_id = $1', [rid])).rows[0].case_id as number
    await claimCase(pool, id, A, T0)
    const r = await act(id, 'remove_image', { scope: 'account', policy: 'illegal-content', reason: 'confirmed' })
    expect(r).toMatchObject({ ok: true, resolved: true, reportIds: [rid], reportOutcome: 'actioned', purge: { did: d, cids: [img] } })
    if (!r.ok || !r.notice) throw new Error('expected a notice')
    expect(r.notice.template).toBe('sor-remove-image-v1')
    expect(r.notice.notice.text).toContain(`account/appeal?action=${r.actionId}`)
    expect(r.notice.notice.text).toContain('A notice from a user')
    expect(r.notice.notice.text).not.toMatch(/\{\{/)
    expect((await pool.query('SELECT kind FROM blocked_images WHERE did = $1 AND cid = $2 AND unblocked_at IS NULL', [d, img])).rows).toEqual([{ kind: 'takedown' }])
    expect((await pool.query('SELECT status, actioned_by FROM reports WHERE id = $1', [rid])).rows[0]).toEqual({ status: 'actioned', actioned_by: A })
    const row = (await pool.query('SELECT action, policy, case_id::int AS case_id, reason FROM admin_actions WHERE id = $1', [r.actionId])).rows[0]
    expect(row).toEqual({ action: 'takedown', policy: 'illegal-content', case_id: Number(id), reason: 'confirmed' })
    const c = await getCase(pool, id)
    expect(c).toMatchObject({ status: 'resolved', resolved_by: A, locked_by: null })
    expect(c?.first_action_at).not.toBeNull()
  })

  it('changes a rating, keeps it over re-index, and reverses it', async () => {
    const d = did()
    const img = cid()
    await image(d, img, 'g')
    const id = (await sig(d, 'explicit', { cid: img })).caseId
    await claimCase(pool, id, A, T0)
    expect(await act(id, 'rating_change', { cid: img, rating: 'bogus' })).toMatchObject({ ok: false })
    expect(await act(id, 'rating_change', { cid: img, rating: 'x' })).toMatchObject({ ok: true, notice: { template: 'sor-rating-change-v1' } })
    expect((await pool.query('SELECT rating FROM images WHERE did = $1', [d])).rows[0].rating).toBe('x')
    expect((await pool.query('SELECT rating, prior_rating FROM rating_overrides WHERE did = $1', [d])).rows).toEqual([{ rating: 'x', prior_rating: 'g' }])
    await claimCase(pool, id, A, T0)
    const rev = await act(id, 'reverse', { what: `rating:${img}`, facts: 'Reviewed again and the original rating was right.' })
    expect(rev).toMatchObject({ ok: true, notice: { template: 'sor-reverse-v1' } })
    expect((await pool.query('SELECT rating FROM images WHERE did = $1', [d])).rows[0].rating).toBe('g')
    expect((await act(id, 'reverse', { what: `rating:${img}`, facts: 'again' })).ok).toBe(false)
  })

  it('suspends and lifts, and acknowledging dismisses linked reports', async () => {
    const d = did()
    const img = cid()
    await image(d, img)
    const id = (await sig(d, 'harassment')).caseId
    await claimCase(pool, id, A, T0)
    expect(await act(id, 'suspend', { policy: 'harassment' })).toMatchObject({ ok: true, notice: { template: 'sor-suspend-v1' } })
    expect((await pool.query('SELECT 1 FROM account_suspensions WHERE did = $1 AND lifted_at IS NULL', [d])).rowCount).toBe(1)
    await claimCase(pool, id, A, T0)
    expect(await act(id, 'reverse', { what: 'suspension', facts: 'Cleared.' })).toMatchObject({ ok: true })
    expect((await pool.query('SELECT 1 FROM account_suspensions WHERE did = $1 AND lifted_at IS NULL', [d])).rowCount).toBe(0)
    const d2 = did()
    const rid = await report(d2, 'spam')
    await syncCases(pool)
    const id2 = (await pool.query('SELECT case_id FROM case_signals WHERE report_id = $1', [rid])).rows[0].case_id as number
    await claimCase(pool, id2, A, T0)
    expect(await act(id2, 'acknowledge', { policy: 'no-violation' })).toMatchObject({ ok: true, notice: null, reportOutcome: 'dismissed', reportIds: [rid] })
    expect((await pool.query('SELECT status FROM reports WHERE id = $1', [rid])).rows[0].status).toBe('dismissed')
  })

  it('keeps child safety in a restricted queue, never offers the image, and only allows divert and comment', async () => {
    const d = did()
    const img = cid()
    await image(d, img)
    const id = (await sig(d, 'child_safety', { cid: img })).caseId
    expect((await listCases(pool, 'child_safety')).map((c) => c.id)).toContain(id)
    expect((await listCases(pool, 'unreviewed')).map((c) => c.id)).not.toContain(id)
    const c = (await getCase(pool, id))!
    expect(c).toMatchObject({ severity: 'critical', child_safety: true })
    expect(allowedActions(c)).toEqual(['divert', 'comment', 'tag'])
    await claimCase(pool, id, A, T0)
    expect(await logReveal(pool, A, id, img, new Date(T0.getTime() + 1000))).toBe(false)
    expect((await caseDetail(pool, id))?.reportNotes).toEqual([])
    expect(await act(id, 'remove_image', { scope: 'image' })).toMatchObject({ ok: false })
    expect(await act(id, 'suspend')).toMatchObject({ ok: false })
    expect(await act(id, 'divert', { policy: 'child-safety' })).toMatchObject({ ok: true, notice: null, resolved: false, purge: { did: d, cids: [img] } })
    expect((await pool.query('SELECT 1 FROM blocked_images WHERE did = $1 AND unblocked_at IS NULL', [d])).rowCount).toBe(1)
    const after = (await getCase(pool, id))!
    expect(after.diverted_at).not.toBeNull()
    expect(allowedActions(after)).toContain('acknowledge')
    expect(await act(id, 'divert', {}, B)).toMatchObject({ ok: false })
    expect(await act(id, 'divert', { policy: 'child-safety' }, 'did:plc:outsider')).toMatchObject({ ok: false })
  })

  it('limits child-safety actions to the configured reviewers', async () => {
    const id = (await sig(did(), 'child_safety')).caseId
    await claimCase(pool, id, B, T0)
    const r = await performCaseAction(pool, B, { caseId: id, action: 'divert', reason: 'r', policy: 'child-safety' }, { ...ctx, env: { MODERATION_CHILD_SAFETY_DIDS: A }, now: T0 }, purge)
    expect(r).toEqual({ ok: false, error: expect.stringContaining('child-safety reviewers') })
  })

  it('escalates, and can send a case to the child-safety queue with the image taken out of serving', async () => {
    const d = did()
    const img = cid()
    await image(d, img)
    const id = (await sig(d, 'illegal', { cid: img })).caseId
    await claimCase(pool, id, A, T0)
    expect(await act(id, 'escalate')).toMatchObject({ ok: true, resolved: false, purge: null })
    expect((await listCases(pool, 'escalated')).map((c) => c.id)).toContain(id)
    expect((await getCase(pool, id))?.locked_by).toBeNull()
    await claimCase(pool, id, B, T0)
    expect(await act(id, 'escalate', { childSafety: true }, B)).toMatchObject({ ok: true, purge: { did: d, cids: [img] } })
    expect((await getCase(pool, id))).toMatchObject({ child_safety: true, severity: 'critical' })
    expect((await queueCounts(pool)).child_safety).toBeGreaterThan(0)
  })

  it('comments and tags, and logs reveals only for the holder', async () => {
    const d = did()
    const img = cid()
    await image(d, img)
    const id = (await sig(d, 'spam', { cid: img })).caseId
    const t = new Date()
    await claimCase(pool, id, A, t)
    expect(await logReveal(pool, B, id, img, t)).toBe(false)
    expect(await logReveal(pool, A, id, img, t)).toBe(true)
    expect(await act(id, 'tag', { tag: 'Bad Tag!' })).toMatchObject({ ok: false })
    expect(await act(id, 'tag', { tag: 'repeat-offender' })).toMatchObject({ ok: true })
    expect(await act(id, 'comment', { reason: 'Looks like the same artist as case 4' })).toMatchObject({ ok: true })
    const detail = (await caseDetail(pool, id))!
    expect(detail.c.tags).toEqual(['repeat-offender'])
    expect(detail.events.map((e) => e.action).sort()).toEqual(['comment', 'reveal_image', 'tag'])
    expect((await getCase(pool, id))?.status).toBe('unreviewed')
  })

  it('puts an appeal in the Appeals queue and has a different reviewer decide it', async () => {
    const d = did()
    const img = cid()
    await image(d, img)
    const id = (await sig(d, 'illegal', { cid: img })).caseId
    await claimCase(pool, id, A, T0)
    const removed = await act(id, 'remove_image', { scope: 'image' })
    if (!removed.ok) throw new Error('setup')
    expect((await appealableActions(pool, d)).map((a) => a.action)).toEqual(['block_image'])
    const filed = await submitAppeal(pool, d, removed.actionId, 'This is my own drawing.')
    expect(filed.ok).toBe(true)
    await syncCases(pool)
    const appealCase = (await listCases(pool, 'appeals', 500)).find((c) => c.subject_did === d)!
    expect(appealCase).toMatchObject({ status: 'appeal', severity: 'moderate' })
    expect((await listCases(pool, 'unreviewed', 500)).some((c) => c.id === appealCase.id)).toBe(false)
    await claimCase(pool, appealCase.id, A, T0)
    expect(await act(appealCase.id, 'uphold', {}, A)).toEqual({ ok: false, error: expect.stringContaining('different admin') })
    expect(await act(appealCase.id, 'acknowledge', {}, A)).toMatchObject({ ok: false })
    await releaseCase(pool, appealCase.id, A)
    await claimCase(pool, appealCase.id, B, T0)
    const done = await act(appealCase.id, 'overturn', { policy: 'no-violation', reason: 'Artist confirmed' }, B)
    expect(done).toMatchObject({ ok: true, resolved: true, appeal: { did: d, outcome: 'overturned' } })
    expect((await pool.query('SELECT 1 FROM blocked_images WHERE did = $1 AND unblocked_at IS NULL', [d])).rowCount).toBe(0)
    expect((await getCase(pool, appealCase.id))?.status).toBe('resolved')
    const logged = await pool.query("SELECT policy, case_id::int AS case_id FROM admin_actions WHERE action = 'appeal_overturned' AND target_did = $1", [d])
    expect(logged.rows).toEqual([{ policy: 'no-violation', case_id: appealCase.id }])
  })

  it('keeps the audit log append-only', async () => {
    await expect(pool.query("UPDATE admin_actions SET reason = 'changed'")).rejects.toThrow(/append-only/)
    await expect(pool.query('DELETE FROM admin_actions')).rejects.toThrow(/append-only/)
  })

  it('stores wellness settings per reviewer with safe defaults', async () => {
    expect(await getWellness(pool, A)).toEqual({ blurPx: 16, grayscale: true })
    expect(await saveWellness(pool, A, { blurPx: '99', grayscale: undefined })).toEqual({ blurPx: 40, grayscale: false })
    expect(await getWellness(pool, A)).toEqual({ blurPx: 40, grayscale: false })
    expect(await getWellness(pool, B)).toEqual({ blurPx: 16, grayscale: true })
    expect(await saveWellness(pool, A, { blurPx: 'junk', grayscale: 'on' })).toEqual({ blurPx: 16, grayscale: true })
  })

  it('reports time to first action, time to resolve against SLA, backlog age, and overturn rate', async () => {
    await pool.query("DELETE FROM case_signals; DELETE FROM review_cases; DELETE FROM appeals")
    const now = new Date('2026-12-01T12:00:00Z')
    const ins = (sev: string, opened: string, first: string | null, resolved: string | null) =>
      pool.query("INSERT INTO review_cases (dedupe_key, subject_did, severity, status, opened_at, first_action_at, resolved_at) VALUES ($1, 'did:plc:m', $2, $3, $4, $5, $6)",
        [`k${++n}`, sev, resolved ? 'resolved' : 'unreviewed', opened, first, resolved])
    await ins('critical', '2026-12-01T00:00:00Z', '2026-12-01T01:00:00Z', '2026-12-01T03:00:00Z')
    await ins('critical', '2026-12-01T00:00:00Z', '2026-12-01T03:00:00Z', '2026-12-01T09:00:00Z')
    await ins('low', '2026-11-30T00:00:00Z', null, null)
    const m = await moderationMetrics(pool, slaHours({}), now)
    expect(m.firstAction).toEqual({ count: 2, medianHours: 2 })
    expect(m.resolve).toMatchObject({ count: 2, medianHours: 6, withinSla: 1, bySeverity: { critical: { count: 2, withinSla: 1 } } })
    expect(m.backlog).toMatchObject({ open: 1, oldestHours: 36, medianHours: 36 })
    expect(m.overturn).toEqual({ decided: 0, overturned: 0, rate: null })
  })
})
