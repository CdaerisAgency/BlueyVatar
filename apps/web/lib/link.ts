import type { OAuthSession } from '@atproto/oauth-client-node'
import { PUBLIC_URL } from './oauth'
import { emailHash, emailMd5 } from '@blueyvatar/core'
import { generateCode, newPending, RESEND_GAP_MS, type PendingCode } from './codes'
import { emailSender, type EmailSender } from './email'
import { decideLink, linkErrorMessage, movedNotice } from './email-policy'
import { looksLikeEmail, maskEmail } from './mask'
import { linkMethod, parseTrustedHosts, pdsHost } from './pds'
import { getStore, type Store } from './store'
import { decryptJson, encryptJson } from './token-crypto'

export type LinkOutcome =
  | { kind: 'linked'; masked: string }
  | { kind: 'code_sent'; masked: string }
  | { kind: 'error'; message: string }

/** Mail a one-time code. The address is kept only as hashes and as an encrypted copy (`v1:` envelope) for the life of the code. */
export async function sendCode(
  did: string,
  email: string,
  store: Store = getStore(),
  sender: EmailSender = emailSender(),
): Promise<LinkOutcome> {
  if (!looksLikeEmail(email)) return { kind: 'error', message: 'That does not look like an email address.' }
  const hash = emailHash(email)
  // Fail before mailing a code the link could never accept. Whether another account holds the hash is not revealed.
  const facts = await store.links.inspect(did, hash)
  const verdict = decideLink(facts)
  if (!verdict.ok) return { kind: 'error', message: linkErrorMessage(verdict) }
  const now = Date.now()
  const existing = await store.codes.get(did)
  if (existing && now - existing.createdAt < RESEND_GAP_MS) {
    return { kind: 'error', message: 'A code was sent a moment ago. Wait a minute before asking again.' }
  }
  const code = generateCode()
  const masked = maskEmail(email)
  await sender.send({
    to: email.trim(),
    subject: 'Your blueyvatar verification code',
    text: `Your code is ${code}. It expires in 15 minutes.\n\nIf you did not ask to link this address on ${PUBLIC_URL}, ignore this message.`,
  })
  // The encrypted address lives in the pending row for at most the life of this code. Confirming stores it as
  // the primary email for notices (when it becomes primary) and uses it to tell a previous owner of a move.
  await store.codes.put(newPending(did, hash, masked, code, now, emailMd5(email), encryptJson(email.trim())))
  return { kind: 'code_sent', masked }
}

/** Applies a confirmed code: links under the ownership policy and, on a move, mails the previous owner. */
export async function confirmLink(
  did: string,
  pending: PendingCode,
  store: Store = getStore(),
  sender: EmailSender = emailSender(),
): Promise<LinkOutcome> {
  const d = await store.links.link(pending.emailHash, did, 'code', pending.emailMd5, pending.emailEnc)
  await store.codes.delete(did)
  if (!d.ok) return { kind: 'error', message: linkErrorMessage(d) }
  if (d.moved && pending.emailEnc) {
    // Best effort: the move already happened and the notice must not undo it.
    const n = movedNotice(PUBLIC_URL)
    await Promise.resolve()
      .then(() => sender.send({ to: decryptJson<string>(pending.emailEnc), ...n }))
      .catch((err) => console.error('move notice failed', err instanceof Error ? err.message : 'unknown'))
  }
  return { kind: 'linked', masked: pending.masked }
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
    const store = getStore()
    const facts = await store.links.inspect(did, emailHash(email))
    // A trusted host vouches for its own users, but taking a hash from another account always needs the mailed code.
    if (facts.owner !== 'other') {
      const d = await store.links.link(emailHash(email), did, method, emailMd5(email), encryptJson(email.trim()))
      if (!d.ok) return { kind: 'error', message: linkErrorMessage(d) }
      return { kind: 'linked', masked: maskEmail(email) }
    }
  }
  return sendCode(did, email)
}
