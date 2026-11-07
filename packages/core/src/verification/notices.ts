import { decryptJson } from './token-crypto.js'
import type { EmailSender } from './email.js'
import { createLogger } from '../observability/log.js'

const log = createLogger({ app: process.env.LOG_APP ?? 'core' })

/**
 * Notification emails to account owners (issue #144, spec sections 9 and 12).
 *
 * usage and billing notices can be switched off per account on /account/notifications.
 * security notices cannot: they tell an owner about changes that may not have been theirs.
 */
export type NoticeKind = 'usage' | 'billing' | 'security'

export interface NoticePrefs {
  usageAlerts: boolean
  billingNotices: boolean
}
export const DEFAULT_NOTICE_PREFS: NoticePrefs = { usageAlerts: true, billingNotices: true }

/** What the account page lists as always on. */
export const SECURITY_NOTICES = [
  'A verified account was removed from your profile after re-verification failed.',
  'Your email address was linked to a different account.',
  'One of your keys was revoked.',
  'Your images were removed, your account was suspended, or an appeal was decided.',
] as const

export interface Notice {
  subject: string
  text: string
}

const base = (publicUrl: string) => publicUrl.replace(/\/+$/, '')
const day = (d: Date) => d.toISOString().slice(0, 10)

/** Plain text only: no tracking pixels, no tracked links. Every message names the account and links the preferences page. */
function frame(did: string, publicUrl: string, body: string, kind: NoticeKind): Notice['text'] {
  const why =
    kind === 'security'
      ? 'This is a security notice. It is always sent.'
      : 'You can turn this kind of message off at the link below.'
  return `${body}\n\n--\nAccount: ${did}\n${why}\nNotification settings: ${base(publicUrl)}/account/notifications`
}

export interface UsageNoticeInput {
  did: string
  threshold: number
  used: number
  included: number
  /** First day of the usage month, `YYYY-MM-DD`. */
  period: string
  publicUrl: string
}

export function usageNotice(i: UsageNoticeInput): Notice {
  const n = (v: number) => v.toLocaleString('en-US')
  const body =
    i.threshold >= 100
      ? `Your account has used all ${n(i.included)} keyed requests included for the month starting ${i.period} (${n(i.used)} so far).\n\n` +
        `Your avatars keep working. Requests past the included volume are handled under the terms of your plan. ` +
        `See ${base(i.publicUrl)}/account/billing for plan options.`
      : `Your account has used ${i.threshold} percent of the keyed requests included for the month starting ${i.period} ` +
        `(${n(i.used)} of ${n(i.included)}).\n\nSee ${base(i.publicUrl)}/account/billing for plan options.`
  return {
    subject: `blueyvatar usage alert: ${i.threshold} percent of included requests`,
    text: frame(i.did, i.publicUrl, body, 'usage'),
  }
}

export function paymentFailedNotice(i: { did: string; graceEnds: Date; publicUrl: string }): Notice {
  const body =
    `Your last blueyvatar payment failed.\n\n` +
    `Your paid limits continue until ${day(i.graceEnds)}. After that the account returns to Free limits. ` +
    `Your data, avatars, and profile are never deleted.\n\n` +
    `Update your payment method in the Stripe customer portal: ${base(i.publicUrl)}/account/billing (choose Manage billing).`
  return { subject: 'Your blueyvatar payment failed', text: frame(i.did, i.publicUrl, body, 'billing') }
}

export function graceExpiredNotice(i: { did: string; plan: string; publicUrl: string }): Notice {
  const body =
    `The grace period for your failed ${i.plan} payment has ended, so your account is back on Free limits.\n\n` +
    `Your data, avatars, and profile are untouched. To restore ${i.plan}, update your payment method or subscribe again at ${base(i.publicUrl)}/account/billing.`
  return { subject: `Your blueyvatar ${i.plan} plan has ended`, text: frame(i.did, i.publicUrl, body, 'billing') }
}

export function subscriptionCanceledNotice(i: { did: string; plan: string; publicUrl: string }): Notice {
  const body =
    `Your ${i.plan} subscription was canceled, so your account is back on Free limits.\n\n` +
    `Your data, avatars, and profile are untouched. You can subscribe again at ${base(i.publicUrl)}/account/billing.`
  return { subject: `Your blueyvatar ${i.plan} subscription was canceled`, text: frame(i.did, i.publicUrl, body, 'billing') }
}

export function keyRevokedNotice(i: { did: string; prefix: string; label?: string | null; publicUrl: string }): Notice {
  const name = i.label ? `${i.label} (${i.prefix})` : i.prefix
  const body =
    `The key ${name} was revoked and no longer works.\n\n` +
    `If you did not do this, sign in at ${base(i.publicUrl)}/account/keys, review your keys, and issue a new one.`
  return { subject: 'A blueyvatar key was revoked', text: frame(i.did, i.publicUrl, body, 'security') }
}

/**
 * One-line outcome for someone who filed a report and left an address (issue #145). The reporter has no
 * account, so there is no preferences link. The admin's internal reason is never included.
 */
export function reportOutcomeNotice(i: { reportId: number; outcome: 'actioned' | 'dismissed'; publicUrl: string }): Notice {
  const line =
    i.outcome === 'actioned'
      ? 'We reviewed your report and took action on the content you reported.'
      : 'We reviewed your report and did not take action on the content you reported.'
  const text =
    `${line}\n\nThank you for helping keep blueyvatar safe. We do not share details of a decision.\n\n` +
    `--\nReport number: ${i.reportId}\nThis is a one-time message about your report. We deleted your email address from our records after sending it. ` +
    `Our content policy: ${base(i.publicUrl)}/policy`
  return { subject: `Update on your blueyvatar report #${i.reportId}`, text }
}

const appealLink = (publicUrl: string, actionId: number) => `${base(publicUrl)}/account/appeal?action=${actionId}`

/**
 * Tells an account owner their images were removed from delivery (issue #172). Names the one-appeal-per-action rule and links
 * the appeal form for this action. The admin's internal reason is never included.
 */
export function takedownNotice(i: { did: string; actionId: number; publicUrl: string }): Notice {
  const body =
    `We removed the images of your account from blueyvatar delivery after a review under our content policy: ${base(i.publicUrl)}/policy\n\n` +
    `Your repository is not changed. If you think this was a mistake, you can appeal once for this action, ` +
    `and a different reviewer will look at it: ${appealLink(i.publicUrl, i.actionId)}`
  return { subject: 'Your blueyvatar images were removed', text: frame(i.did, i.publicUrl, body, 'security') }
}

export function suspensionNotice(i: { did: string; actionId: number; publicUrl: string }): Notice {
  const body =
    `Your blueyvatar account was suspended after a review under our content policy: ${base(i.publicUrl)}/policy\n\n` +
    `While it is suspended, your images are not served. Your repository is not changed. If you think this was a mistake, you can appeal once for this action, ` +
    `and a different reviewer will look at it: ${appealLink(i.publicUrl, i.actionId)}`
  return { subject: 'Your blueyvatar account was suspended', text: frame(i.did, i.publicUrl, body, 'security') }
}

/** Outcome of an appeal. Like the reporter notice, it never includes the admin's internal note. */
export function appealOutcomeNotice(i: { did: string; appealId: number; outcome: 'overturned' | 'upheld'; publicUrl: string }): Notice {
  const line =
    i.outcome === 'overturned'
      ? 'We reviewed your appeal and reversed the decision. Your images are served again after caches refresh.'
      : 'We reviewed your appeal and kept the decision. This was the one appeal available for this action.'
  const body = `${line}\n\nAppeal number: ${i.appealId}\nOur content policy: ${base(i.publicUrl)}/policy`
  return { subject: `Update on your blueyvatar appeal #${i.appealId}`, text: frame(i.did, i.publicUrl, body, 'security') }
}

/**
 * Statement of reasons for a moderation action (issue #209), with the fields EU Digital Services Act Article 17(3) lists:
 * (a) the action and its scope and duration, (b) the facts relied on and whether they came from a notice or our own initiative,
 * (c) whether automated means were used, (d) and (e) the legal or contractual ground, and (f) the redress options.
 * Each template has {{placeholders}}. A notice with any unfilled placeholder is never built, so it cannot be sent
 * (the same rule Ozone applies to its email templates).
 */
export type SorAction = 'remove_image' | 'suspend' | 'warn' | 'rating_change' | 'reverse'
export const SOR_VARS = ['scope', 'duration', 'facts', 'source', 'automated', 'policy', 'policy_url', 'explanation', 'appeal_link'] as const
export type SorVar = (typeof SOR_VARS)[number]
export type SorVars = Partial<Record<SorVar, string>>

const SOR_TAIL =
  '\n\nStatement of reasons (Article 17, EU Digital Services Act)\n' +
  'Facts and circumstances we relied on: {{facts}}\n' +
  'How we learned of it: {{source}}\n' +
  'Automated means: {{automated}}\n' +
  'Ground: this goes against our content policy, "{{policy}}" ({{policy_url}}). {{explanation}}\n\n' +
  'Your options: you can appeal once for this action, and a different reviewer will decide: {{appeal_link}}. ' +
  'You can also use an out-of-court dispute settlement body certified under Article 21 of the Digital Services Act, or go to court.'

export const SOR_TEMPLATES: Record<SorAction, { name: string; subject: string; body: string; needs: SorVar[] }> = {
  remove_image: {
    name: 'sor-remove-image-v1', subject: 'Your blueyvatar images were removed',
    body: 'What we did: we stopped serving {{scope}} from blueyvatar. Your repository is not changed. Duration: {{duration}}.' + SOR_TAIL,
    needs: ['scope', 'duration', 'facts', 'source', 'automated', 'policy', 'policy_url', 'explanation', 'appeal_link'],
  },
  suspend: {
    name: 'sor-suspend-v1', subject: 'Your blueyvatar account was suspended',
    body: 'What we did: we suspended your account, so none of your images are served. Your repository is not changed. Duration: {{duration}}.' + SOR_TAIL,
    needs: ['duration', 'facts', 'source', 'automated', 'policy', 'policy_url', 'explanation', 'appeal_link'],
  },
  warn: {
    name: 'sor-warn-v1', subject: 'A warning about your blueyvatar content',
    body: 'What we did: we are warning you about {{scope}}. We did not restrict your account or remove anything. Duration: {{duration}}.' + SOR_TAIL,
    needs: ['scope', 'duration', 'facts', 'source', 'automated', 'policy', 'policy_url', 'explanation', 'appeal_link'],
  },
  rating_change: {
    name: 'sor-rating-change-v1', subject: 'The rating of your blueyvatar image was changed',
    body: 'What we did: we changed the rating shown for {{scope}} in blueyvatar. Your repository is not changed. Duration: {{duration}}.' + SOR_TAIL,
    needs: ['scope', 'duration', 'facts', 'source', 'automated', 'policy', 'policy_url', 'explanation', 'appeal_link'],
  },
  reverse: {
    name: 'sor-reverse-v1', subject: 'We reversed a blueyvatar moderation action',
    body: 'What we did: we reversed an earlier action on your account ({{scope}}). It takes effect after caches refresh.\n\nWhy: {{facts}}\nPolicy reviewed: "{{policy}}" ({{policy_url}}).',
    needs: ['scope', 'facts', 'policy', 'policy_url'],
  },
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g

/** Names of placeholders still present in the text. */
export function unfilledPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))]
}

export type SorResult = { ok: true; template: string; notice: Notice } | { ok: false; missing: string[] }

/**
 * Fills the template for an action. Returns the names of everything missing instead of a notice when any value is empty,
 * unknown, or itself contains a placeholder, or any placeholder remains. The caller must not send in that case.
 */
export function statementOfReasonsNotice(i: { did: string; action: SorAction; vars: SorVars; publicUrl: string }): SorResult {
  const t = SOR_TEMPLATES[i.action]
  const missing = new Set<string>()
  const fill = (text: string) =>
    text.replace(PLACEHOLDER, (m, name: string) => {
      const v = (i.vars as Record<string, string | undefined>)[name]?.trim()
      if (!v || v.includes('{{')) {
        missing.add(name)
        return m
      }
      return v
    })
  const body = fill(t.body)
  for (const n of t.needs) if (!i.vars[n]?.trim()) missing.add(n)
  const left = unfilledPlaceholders(body)
  for (const n of left) missing.add(n)
  if (missing.size) return { ok: false, missing: [...missing] }
  return { ok: true, template: t.name, notice: { subject: t.subject, text: frame(i.did, i.publicUrl, body, 'security') } }
}

/** Where a notifier finds the owner's address and preferences. */
export interface NoticeDirectory {
  /** The decrypted primary email, or null when none is on file. */
  address(did: string): Promise<string | null>
  prefs(did: string): Promise<NoticePrefs>
}

export type NoticeResult = 'sent' | 'off' | 'no_address' | 'failed'

export const noticeAllowed = (p: NoticePrefs, kind: NoticeKind) =>
  kind === 'usage' ? p.usageAlerts : kind === 'billing' ? p.billingNotices : true

/** Sends notices honoring preferences. Never throws and never logs an address. */
export class Notifier {
  constructor(
    private sender: EmailSender,
    private dir: NoticeDirectory,
  ) {}

  async send(did: string, kind: NoticeKind, n: Notice): Promise<NoticeResult> {
    try {
      if (!noticeAllowed(await this.dir.prefs(did), kind)) return 'off'
      const to = await this.dir.address(did)
      if (!to) {
        log.warn(`${kind} notice not sent: no address on file`, { did })
        return 'no_address'
      }
      await this.sender.send({ to, ...n })
      return 'sent'
    } catch (err) {
      log.error(`${kind} notice failed`, { error: err instanceof Error ? err.message : 'unknown' })
      return 'failed'
    }
  }
}

type Query = { query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> }

/** notice_emails (migration 0013) and notification_prefs (0019). */
export function pgNoticeDirectory(pool: Query, master?: Buffer): NoticeDirectory & {
  setPrefs(did: string, p: NoticePrefs): Promise<void>
} {
  return {
    async address(did) {
      const r = await pool.query('SELECT email_enc FROM notice_emails WHERE did = $1', [did])
      const enc = r.rows[0]?.email_enc as string | undefined
      if (!enc) return null
      try {
        return decryptJson<string>(enc, master)
      } catch {
        log.error('stored notice address could not be decrypted; check TOKEN_ENCRYPTION_KEY')
        return null
      }
    },
    async prefs(did) {
      const r = await pool.query('SELECT usage_alerts, billing_notices FROM notification_prefs WHERE did = $1', [did])
      const row = r.rows[0]
      return row ? { usageAlerts: row.usage_alerts as boolean, billingNotices: row.billing_notices as boolean } : { ...DEFAULT_NOTICE_PREFS }
    },
    async setPrefs(did, p) {
      await pool.query(
        `INSERT INTO notification_prefs (did, usage_alerts, billing_notices) VALUES ($1, $2, $3)
         ON CONFLICT (did) DO UPDATE SET usage_alerts = EXCLUDED.usage_alerts, billing_notices = EXCLUDED.billing_notices, updated_at = now()`,
        [did, p.usageAlerts, p.billingNotices],
      )
    },
  }
}
