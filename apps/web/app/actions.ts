'use server'

import { isSha256Hex, parseIdentifier } from '@blueyvatar/core'
import { redirect } from 'next/navigation'
import { checkCode, MAX_ATTEMPTS } from '../lib/codes'
import { currentDid, oauthClient } from '../lib/auth'
import { sendCode } from '../lib/link'
import { EMAIL_LINK_SCOPE, SIGN_IN_SCOPE } from '../lib/oauth'
import { getStore } from '../lib/store'

const to = (path: string, key: string, value: string): never => redirect(`${path}?${key}=${encodeURIComponent(value)}`)

async function authorize(input: string, scope: string, state: 'login' | 'link'): Promise<never> {
  let url: URL
  try {
    url = await (await oauthClient()).authorize(input, { scope, state })
  } catch (err) {
    console.error('oauth authorize failed', err instanceof Error ? err.message : 'unknown')
    return to(state === 'login' ? '/login' : '/account', 'error', 'Could not start sign-in. Check the handle and try again.')
  }
  return redirect(url.toString())
}

export async function login(form: FormData): Promise<void> {
  const id = parseIdentifier(String(form.get('handle') ?? ''))
  if (!id || id.kind === 'hash') return to('/login', 'error', 'Enter a valid handle such as alice.bsky.social.')
  await authorize(id.value, SIGN_IN_SCOPE, 'login')
}

/** Re-authorizes with account:email. The email session is discarded right after linking. */
export async function linkEmail(): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
  await authorize(did, EMAIL_LINK_SCOPE, 'link')
}

export async function addEmail(form: FormData): Promise<void> {
  const did = await currentDid()
  if (!did) return redirect('/login')
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
  const store = getStore()
  const pending = await store.codes.get(did)
  if (!pending) return to('/account', 'error', 'No code is pending. Request a new one.')
  const result = checkCode(pending, String(form.get('code') ?? ''), Date.now())
  if (result.ok) {
    await store.links.upsert(pending.emailHash, did, 'code', pending.emailMd5)
    await store.codes.delete(did)
    return to('/account', 'linked', pending.masked)
  }
  if (result.reason === 'expired') {
    await store.codes.delete(did)
    return to('/account', 'error', 'That code expired. Request a new one.')
  }
  if (result.reason === 'locked') return to('/account', 'error', `Too many attempts (max ${MAX_ATTEMPTS}). Request a new code.`)
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

