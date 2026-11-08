'use server'

import { parseIdentifier } from '@blueyvatar/core'
import { redirect } from 'next/navigation'
import { oauthClient, rememberNext } from '../../lib/auth'
import { runLogin, type LoginState } from '../../lib/login-form'
import { safeNext } from '../../lib/next-path'
import { signInScope } from '../../lib/oauth'
import { failed, limited, lockedOut } from '../../lib/rate-guard'
import { reportError } from '../../lib/obs'

/** Returns failures to the form so the typed handle stays. Success redirects to the OAuth page. */
export async function loginWithHandle(_prev: LoginState, form: FormData): Promise<LoginState> {
  const next = safeNext(String(form.get('next') ?? ''))
  const r = await runLogin(form, next, {
    blocked: async () => (await lockedOut('loginFail.ip')) ?? (await limited(['login.ip'])),
    parse: (h) => parseIdentifier(h),
    failed: () => failed('loginFail.ip'),
    remember: () => rememberNext(next),
    start: async (id) => {
      try {
        const url = await (await oauthClient()).authorize(id, { scope: signInScope(), state: 'login' })
        return { ok: true, url: url.toString() }
      } catch (err) {
        reportError('oauth authorize failed', err)
        return { ok: false }
      }
    },
  })
  if (r.redirectTo) return redirect(r.redirectTo)
  return r
}
