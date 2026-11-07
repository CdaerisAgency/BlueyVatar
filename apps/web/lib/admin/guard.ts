import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { currentDid } from '../auth'
import { PUBLIC_URL } from '../oauth'
import { getPool } from '../store'
import { ADMIN_COOKIE, ADMIN_SESSION_TTL_MS, adminEnabled, isAdminDid } from './config'
import { readAdminSession } from './session'

/**
 * Admin pages answer 404 unless the feature is configured and the signed-in account is on the ADMIN_DIDS list, so
 * the page does not reveal itself to anyone else. The second step is a short admin session started with a one-time code.
 */
export async function requireAdminDid() {
  if (!adminEnabled()) return notFound()
  const did = await currentDid()
  if (!did) return redirect('/login')
  if (!isAdminDid(did)) return notFound()
  const pool = getPool()
  if (!pool) return notFound()
  return { did, pool }
}

/** Full check for pages and actions: allowlisted DID plus a live admin session. */
export async function requireAdmin() {
  const { did, pool } = await requireAdminDid()
  const jar = await cookies()
  if (!(await readAdminSession(pool, jar.get(ADMIN_COOKIE)?.value, did))) return redirect('/admin/login')
  return { did, pool }
}

export async function setAdminCookie(token: string): Promise<void> {
  ;(await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: PUBLIC_URL.startsWith('https://'),
    sameSite: 'strict',
    path: '/admin',
    maxAge: ADMIN_SESSION_TTL_MS / 1000,
  })
}

export async function adminToken(): Promise<string | undefined> {
  return (await cookies()).get(ADMIN_COOKIE)?.value
}

export async function clearAdminCookie(): Promise<void> {
  ;(await cookies()).delete({ name: ADMIN_COOKIE, path: '/admin' })
}
