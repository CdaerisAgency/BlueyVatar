import type { OAuthSession } from '@atproto/oauth-client-node'
import { PUBLIC_URL } from './oauth'
import { emailHash, emailMd5 } from '@blueyvatar/core'
import { generateCode, newPending, RESEND_GAP_MS } from './codes'
import { emailSender } from './email'
import { looksLikeEmail, maskEmail } from './mask'
import { linkMethod, parseTrustedHosts, pdsHost } from './pds'
import { getStore } from './store'

export type LinkOutcome =
  | { kind: 'linked'; masked: string }
  | { kind: 'code_sent'; masked: string }
  | { kind: 'error'; message: string }

/** Mail a one-time code. Keeps only hashes; the raw address lives in this call. */
export async function sendCode(did: string, email: string): Promise<LinkOutcome> {
  if (!looksLikeEmail(email)) return { kind: 'error', message: 'That does not look like an email address.' }
  const store = getStore()
  const now = Date.now()
  const existing = await store.codes.get(did)
  if (existing && now - existing.createdAt < RESEND_GAP_MS) {
    return { kind: 'error', message: 'A code was sent a moment ago. Wait a minute before asking again.' }
  }
  const code = generateCode()
  const masked = maskEmail(email)
  await emailSender().send({
    to: email.trim(),
    subject: 'Your blueyvatar verification code',
    text: `Your code is ${code}. It expires in 15 minutes.\n\nIf you did not ask to link this address on ${PUBLIC_URL}, ignore this message.`,
  })
  await store.codes.put(newPending(did, emailHash(email), masked, code, now, emailMd5(email)))
  return { kind: 'code_sent', masked }
}

/** Reads the PDS email through the email-scoped OAuth session and links or mails a code. */
export async function linkFromSession(session: OAuthSession): Promise<LinkOutcome> {
  const did = session.did
  const res = await session.fetchHandler('/xrpc/com.atproto.server.getSession')
  if (!res.ok) return { kind: 'error', message: 'Your PDS did not return an email address.' }
  const body = (await res.json()) as { email?: string; emailConfirmed?: boolean }
  const email = body.email
  if (!email) return { kind: 'error', message: 'Your account has no email address, or the email permission was not granted.' }
  const { aud } = await session.getTokenInfo(false)
  const method = linkMethod({
    emailConfirmed: body.emailConfirmed === true,
    host: pdsHost(aud),
    trusted: parseTrustedHosts(process.env.TRUSTED_PDS_HOSTS),
  })
  if (method === 'trusted_pds') {
    await getStore().links.upsert(emailHash(email), did, method, emailMd5(email))
    return { kind: 'linked', masked: maskEmail(email) }
  }
  return sendCode(did, email)
}
