'use server'

import { isSha256Hex, parseIdentifier } from '@blueyvatar/core'
import { redirect } from 'next/navigation'
import { checkCode, MAX_ATTEMPTS } from '../lib/codes'
import { currentDid, oauthClient, rememberNext } from '../lib/auth'
import { safeNext } from '../lib/next-path'
import { confirmLink, sendCode } from '../lib/link'
import { emailLinkScope, signInScope } from '../lib/oauth'
import { failed, limited, lockedOut } from '../lib/rate-guard'
import { getStore } from '../lib/store'
import { reportError } from '../lib/obs'

const to = (path: string, key: string, value: string): never => redirect(`${path}?${key}=${encodeURIComponent(value)}`)

async function authorize(input: string, scope: string, state: 'login' | 'link'): Promise<never> {
  let url: URL
  try {
    url = await (await oauthClient()).authorize(input, { scope, state })
  } catch (err) {
    reportError('oauth authorize failed', err)
    if (state === 'login') await failed('loginFail.ip')
    return to(state === 'login' ? '/login' : '/account', 'error', 'Could not start sign-in. Check the handle and try again.')
  }
  return redirect(url.toString())
}

export async function login(form: FormData): Promise<void> {
  const next = safeNext(String(form.get('next') ?? ''))
  const back = (msg: string): never => redirect(`/login?error=${encodeURIComponent(msg)}${next === '/account' ? '' : `&next=${encodeURIComponent(next)}`}`)
  const wait = (await lockedOut('loginFail.ip')) ?? (await limited(['login.ip']))
  if (wait) return back(wait)
  const id = parseIdentifier(String(form.get('handle') ?? ''))
  if (!id || id.kind === 'hash') {
    await failed('loginFail.ip')
    return back('Enter a valid handle such as alice.bsky.social.')
  }
  await rememberNext(next)
  await authorize(id.value, signInScope(), 'login')
}

/** Re-authorizes with account:email. The email session is discarded right after linking. */
export async function linkEmail(): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const wait = await limited(['login.did', 'login.ip'], did)
  if (wait) return to('/account', 'error', wait)
  await authorize(did, emailLinkScope(), 'link')
}

export async function addEmail(form: FormData): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const wait = await limited(['addEmail.did', 'addEmail.ip'], did)
  if (wait) return to('/account', 'error', wait)
  let outcome
  try {
    outcome = await sendCode(did, String(form.get('email') ?? ''))
  } catch {
    return to('/account', 'error', 'Could not send the code. Try again later.')
  }
  if (outcome.kind === 'error') return to('/account', 'error', outcome.message)
  return redirect('/account/verify')
}

export async function verifyCode(form: FormData): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  // Failures count per account across codes, so asking for a fresh code does not reset the guess budget.
  const locked = await lockedOut('codeFail.did', did)
  if (locked) return to('/account', 'error', locked)
  const store = getStore()
  const pending = await store.codes.get(did)
  if (!pending) return to('/account', 'error', 'No code is pending. Request a new one.')
  const result = checkCode(pending, String(form.get('code') ?? ''), Date.now())
  if (result.ok) {
    const outcome = await confirmLink(did, pending, store)
    if (outcome.kind === 'error') return to('/account', 'error', outcome.message)
    return to('/account', 'linked', pending.masked)
  }
  if (result.reason === 'expired') {
    await store.codes.delete(did)
    return to('/account', 'error', 'That code expired. Request a new one.')
  }
  if (result.reason === 'locked') return to('/account', 'error', `Too many attempts (max ${MAX_ATTEMPTS}). Request a new code.`)
  await failed('codeFail.did', did)
  await store.codes.setAttempts(did, result.attempts)
  return to('/account/verify', 'error', 'That code is not right.')
}

export async function unlink(form: FormData): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const hash = String(form.get('hash') ?? '')
  if (isSha256Hex(hash)) await getStore().links.remove(did, hash)
  return redirect('/account')
}

export async function makePrimary(form: FormData): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  const hash = String(form.get('hash') ?? '')
  if (isSha256Hex(hash)) await getStore().links.setPrimary(did, hash)
  return redirect('/account')
}

