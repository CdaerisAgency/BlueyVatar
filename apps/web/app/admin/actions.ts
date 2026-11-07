'use server'

import { redirect } from 'next/navigation'
import { appealOutcomeNotice, emailSender } from '@blueyvatar/core/verification'
import { canViewChildSafety } from '@blueyvatar/core/moderation'
import { adminToken, clearAdminCookie, requireAdmin, requireAdminDid, setAdminCookie } from '../../lib/admin/guard'
import { totpSecret } from '../../lib/admin/config'
import { DID_RE } from '../../lib/admin/moderation'
import { CASE_ACTIONS, getCase, isQueue, logReveal, nextCase, openManualCase, performCaseAction, recordNotice, releaseCase, saveWellness, skipCase, type CaseAction } from '../../lib/admin/review'
import { PUBLIC_URL } from '../../lib/oauth'
import { getNotifier } from '../../lib/notify'
import { notifyReporters } from '../../lib/admin/followup'
import { purgerFromEnv } from '../../lib/admin/purge'
import { consumeTotp, createAdminSession, revokeAdminSession } from '../../lib/admin/session'
import { failed, limited, lockedOut } from '../../lib/rate-guard'

const to = (path: string, key: string, value: string): never => redirect(`${path}?${key}=${encodeURIComponent(value)}`)

/** Second step of admin sign-in. Wrong codes count toward a short lockout for the account and the network. */
export async function adminLogin(form: FormData): Promise<void> {
  const { did, pool } = await requireAdminDid()
  const wait = (await lockedOut('adminFail.did', did)) ?? (await lockedOut('adminFail.ip')) ?? (await limited(['adminLogin.did', 'adminLogin.ip'], did))
  if (wait) return to('/admin/login', 'error', wait)
  const ok = await consumeTotp(pool, did, totpSecret() ?? '', String(form.get('code') ?? ''))
  if (!ok) {
    await failed('adminFail.did', did)
    await failed('adminFail.ip')
    return to('/admin/login', 'error', 'That code did not work.')
  }
  await setAdminCookie(await createAdminSession(pool, did))
  return redirect('/admin')
}

export async function adminLogout(): Promise<void> {
  const { pool } = await requireAdminDid()
  await revokeAdminSession(pool, await adminToken())
  await clearAdminCookie()
  return redirect('/')
}

const casePath = (id: number) => `/admin/cases/${id}`

/** Runs a reviewer action from the case page, then does what must happen after the commit: cache purge, owner notice, reporter notices. */
export async function caseAction(form: FormData): Promise<void> {
  const a = await requireAdmin()
  const id = Number(form.get('case'))
  const action = String(form.get('action') ?? '') as CaseAction
  if (!Number.isSafeInteger(id) || !CASE_ACTIONS.includes(action)) return to('/admin', 'msg', 'Unknown action.')
  const back = casePath(id)
  const wait = await limited(['adminAction.did', 'adminAction.ip'], a.did)
  if (wait) return to(back, 'msg', wait)
  const text = (k: string) => String(form.get(k) ?? '')
  const out = await performCaseAction(a.pool, a.did, {
    caseId: id, action, reason: form.get('reason'), policy: form.get('policy'), scope: text('scope'), cid: text('cid') || undefined,
    rating: text('rating'), tag: text('tag'), what: text('what'), facts: text('facts'), explanation: text('explanation'), childSafety: form.get('childSafety') === 'on',
  }, { publicUrl: PUBLIC_URL }, purgerFromEnv())
  if (!out.ok) return to(back, 'msg', out.error)
  let msg = out.message
  if (out.purge && !(await purgerFromEnv()(out.purge.did, out.purge.cids))) msg += ' Cache purge did not run: purge /img/ for this account in Cloudflare.'
  if (out.notice) {
    const result = await getNotifier().send(out.notice.did, 'security', out.notice.notice)
    await recordNotice(a.pool, a.did, id, out.notice.did, out.notice.template, result)
    if (result !== 'sent') msg += ' The owner was not emailed (no address on file or send failed).'
  }
  if (out.appeal) {
    const sent = await getNotifier().send(out.appeal.did, 'security', appealOutcomeNotice({ did: out.appeal.did, appealId: out.appeal.appealId, outcome: out.appeal.outcome, publicUrl: PUBLIC_URL }))
    if (sent !== 'sent') msg += ' The appellant was not emailed (no address on file or send failed).'
  }
  if (out.reportIds.length) await notifyReporters(a.pool, emailSender(), out.reportIds, out.reportOutcome, PUBLIC_URL)
  return to(back, 'msg', msg)
}

/** Opens the next case in a queue for this reviewer, locked to them. */
export async function nextCaseAction(form: FormData): Promise<void> {
  const { did, pool } = await requireAdmin()
  const queue = form.get('queue')
  if (!isQueue(queue)) return to('/admin', 'msg', 'Unknown queue.')
  if (queue === 'child_safety' && !canViewChildSafety(did)) return to('/admin', 'msg', 'That queue is restricted.')
  const id = await nextCase(pool, queue, did)
  return id === null ? to(`/admin/queue/${queue}`, 'msg', 'No case is waiting for you in this queue.') : redirect(casePath(id))
}

/** Gives the case back and moves to the next one. The skipped case stays out of this reviewer's picks for a few hours. */
export async function skipCaseAction(form: FormData): Promise<void> {
  const { did, pool } = await requireAdmin()
  const id = Number(form.get('case'))
  const c = Number.isSafeInteger(id) ? await getCase(pool, id) : null
  if (!c) return to('/admin', 'msg', 'Case not found.')
  await skipCase(pool, id, did)
  const queue = c.child_safety ? 'child_safety' : c.status === 'escalated' ? 'escalated' : c.status === 'appeal' ? 'appeals' : 'unreviewed'
  const next = c.status === 'resolved' ? null : await nextCase(pool, queue, did)
  return next === null ? to(`/admin/queue/${queue}`, 'msg', 'Skipped. No other case is waiting for you.') : redirect(casePath(next))
}

export async function releaseCaseAction(form: FormData): Promise<void> {
  const { did, pool } = await requireAdmin()
  const id = Number(form.get('case'))
  if (Number.isSafeInteger(id)) await releaseCase(pool, id, did)
  return redirect('/admin')
}

/** Called when the reviewer clicks Reveal. The click is logged before the image is shown. */
export async function revealAction(caseId: number, cid: string): Promise<boolean> {
  const { did, pool } = await requireAdmin()
  if (!Number.isSafeInteger(caseId) || !/^[A-Za-z0-9]{10,200}$/.test(cid)) return false
  return logReveal(pool, did, caseId, cid)
}

export async function saveWellnessAction(form: FormData): Promise<void> {
  const { did, pool } = await requireAdmin()
  await saveWellness(pool, did, { blurPx: form.get('blur'), grayscale: form.get('grayscale') })
  const back = String(form.get('back') ?? '')
  return to(/^\/admin(\/|$)/.test(back) ? back : '/admin', 'msg', 'Wellness settings saved.')
}

/** Opens (or finds) the case for an account, from the account page. */
export async function openCaseAction(form: FormData): Promise<void> {
  const { pool } = await requireAdmin()
  const did = String(form.get('did') ?? '')
  if (!DID_RE.test(did)) return to('/admin', 'msg', 'Unknown account.')
  return redirect(casePath(await openManualCase(pool, did)))
}
