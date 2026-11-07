import {
  attestationWriterFromEnv, decryptJson, emailSender, mastodonClaimMatches, parseMastodonUri, profileLinkFor, safeFetch, verifyRelMe,
  type EmailSender, type Fetcher, type VerifyOutcome,
} from '@blueyvatar/core/verification'
import type pg from 'pg'
import type { DueClaim, OnRevoked, Verifier } from './reverify.js'

const GITHUB_LOGIN = /^https:\/\/github\.com\/([A-Za-z\d-]{1,39})$/
const transient = (reason: string): VerifyOutcome => ({ ok: false, reason, transient: true })

/**
 * The same checks as the claims page, as far as they can run without the user present.
 * rel="me" claims re-run the identical reciprocal-link check. OAuth claims cannot be re-run
 * (the token is not kept), so they re-check that the account still exists at the claimed address.
 */
export function makeVerifier(publicUrl: string, f: Fetcher = safeFetch): Verifier {
  return async (c: DueClaim): Promise<VerifyOutcome> => {
    try {
      if (c.method === 'rel-me') {
        if (!c.handle) return transient('No handle on file yet.')
        return await verifyRelMe(c.claimUri, profileLinkFor(publicUrl, c.handle), f)
      }
      if (c.method === 'github-oauth') {
        const login = GITHUB_LOGIN.exec(c.claimUri)?.[1]
        if (!login) return { ok: false, reason: 'The claim address is not a GitHub profile.' }
        const r = await f(`https://api.github.com/users/${login}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'blueyvatar' }, maxBytes: 500_000 })
        if (r.status === 200) return { ok: true }
        return r.status === 404 ? { ok: false, reason: 'The GitHub account no longer exists at that address.' } : transient(`GitHub answered with status ${r.status}.`)
      }
      if (c.method === 'mastodon-oauth') {
        const m = parseMastodonUri(c.claimUri)
        if (!m) return { ok: false, reason: 'The claim address is not a Mastodon profile.' }
        const r = await f(`https://${m.instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(m.user)}`, { headers: { accept: 'application/json' }, maxBytes: 500_000 })
        if (r.status === 404) return { ok: false, reason: 'The Mastodon account no longer exists at that address.' }
        if (r.status !== 200) return transient(`${m.instance} answered with status ${r.status}.`)
        let url: unknown
        try { url = (JSON.parse(r.text) as { url?: unknown }).url } catch { return transient('The instance returned an unreadable answer.') }
        return typeof url === 'string' && mastodonClaimMatches(url, c.claimUri) ? { ok: true } : { ok: false, reason: 'The Mastodon account moved or no longer matches.' }
      }
      return transient(`Unknown verification method "${c.method}".`)
    } catch {
      return transient('The account could not be checked.')
    }
  }
}

/** Resolves a DID to a deliverable address, or null. */
export type RecipientLookup = (did: string) => Promise<string | null>

/** Reads the account's primary email from notice_emails and decrypts it (TOKEN_ENCRYPTION_KEY). Never logs the address. */
export function pgRecipientLookup(pool: Pick<pg.Pool, 'query'>, master?: Buffer): RecipientLookup {
  return async (did) => {
    const r = await pool.query('SELECT email_enc FROM notice_emails WHERE did = $1', [did])
    const enc = r.rows[0]?.email_enc as string | undefined
    if (!enc) return null
    try {
      return decryptJson<string>(enc, master)
    } catch {
      console.error('stored notice address could not be decrypted; check TOKEN_ENCRYPTION_KEY')
      return null
    }
  }
}

export function emailNotice(sender: EmailSender, lookup: RecipientLookup, publicUrl: string): OnRevoked {
  return async (c, reason) => {
    const to = await lookup(c.did)
    if (!to) {
      console.warn('claim revoked; no address on file, notice not sent')
      return
    }
    await sender.send({
      to,
      subject: 'A verified account was removed from your blueyvatar profile',
      text: `We could not re-verify ${c.claimUri} three times in a row, so its verified badge was removed.\n\nLast result: ${reason}\n\nFix the problem and run verification again at ${publicUrl.replace(/\/+$/, '')}/account/claims.`,
    })
  }
}

export function reverifyFromEnv(pool: Pick<pg.Pool, 'query'>, env: Record<string, string | undefined> = process.env) {
  const publicUrl = env.PUBLIC_URL ?? 'https://blueyvatar.com'
  const writer = attestationWriterFromEnv(env)
  return {
    verify: makeVerifier(publicUrl),
    remove: (uri: string) => writer.remove(uri),
    onRevoked: emailNotice(emailSender(env), pgRecipientLookup(pool), publicUrl),
    afterMs: Number(env.REVERIFY_AFTER_DAYS ?? 30) * 86_400_000,
    everyMs: Number(env.REVERIFY_INTERVAL_HOURS ?? 24) * 3_600_000,
  }
}
