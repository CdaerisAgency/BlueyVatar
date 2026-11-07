'use server'

import { redirect } from 'next/navigation'
import { adminToken, clearAdminCookie, requireAdmin, requireAdminDid, setAdminCookie } from '../../lib/admin/guard'
import { totpSecret } from '../../lib/admin/config'
import { cleanReason, dismissReport, suspend, takedown, unblockImage, unsuspend, type Result } from '../../lib/admin/moderation'
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

const note = (r: Result, ok: string): string =>
  !r.ok ? r.error : r.purged ? ok : `${ok} Cache purge did not run: purge /img/ for this account in Cloudflare.`

async function run(back: string, fn: (a: { did: string; pool: import('pg').Pool }, reason: string) => Promise<Result>, ok: string, form: FormData): Promise<void> {
  const a = await requireAdmin()
  const wait = await limited(['adminAction.did', 'adminAction.ip'], a.did)
  if (wait) return to(back, 'msg', wait)
  const reason = cleanReason(form.get('reason'))
  if (!reason) return to(back, 'msg', 'Enter a reason (up to 500 characters).')
  return to(back, 'msg', note(await fn(a, reason), ok))
}

const didOf = (form: FormData) => String(form.get('did') ?? '')
const accountPath = (did: string) => `/admin/account?did=${encodeURIComponent(did)}`

export async function dismissAction(form: FormData): Promise<void> {
  const id = Number(form.get('report'))
  return run('/admin', ({ did, pool }, reason) => dismissReport(pool, did, id, reason), `Report ${id} dismissed.`, form)
}

export async function takedownAction(form: FormData): Promise<void> {
  const target = didOf(form)
  const report = Number(form.get('report')) || undefined
  return run(report ? `/admin/reports/${report}` : accountPath(target), ({ did, pool }, reason) => takedown(pool, purgerFromEnv(), did, target, reason, report), 'Takedown recorded.', form)
}

export async function suspendAction(form: FormData): Promise<void> {
  const target = didOf(form)
  return run(accountPath(target), ({ did, pool }, reason) => suspend(pool, purgerFromEnv(), did, target, reason), 'Account suspended.', form)
}

export async function unsuspendAction(form: FormData): Promise<void> {
  const target = didOf(form)
  return run(accountPath(target), ({ did, pool }, reason) => unsuspend(pool, purgerFromEnv(), did, target, reason), 'Suspension lifted.', form)
}

export async function unblockAction(form: FormData): Promise<void> {
  const target = didOf(form)
  const cid = String(form.get('cid') ?? '')
  return run(accountPath(target), ({ did, pool }, reason) => unblockImage(pool, purgerFromEnv(), did, target, cid, reason), 'Image unblocked.', form)
}
