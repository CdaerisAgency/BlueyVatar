import { emailSender, type EmailSender } from '@blueyvatar/core/verification'
import { buildDigest, digestIsQuiet, formatDigest, slaHours } from '@blueyvatar/core/moderation'
import type pg from 'pg'
import { pgRecipientLookup } from './reverify-wiring.js'
import { errors, log } from './obs.js'

type Env = Record<string, string | undefined>
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/
const DID_RE = /^did:(plc|web):\S+$/

/**
 * Where the digest goes: MODERATION_DIGEST_TO (comma or space separated addresses) when set, otherwise the primary email on file
 * for the first ADMIN_DIDS account that has one (the same address that account gets security notices at). Empty when neither exists.
 */
export async function digestRecipients(pool: Pick<pg.Pool, 'query'>, env: Env = process.env): Promise<string[]> {
  const set = (env.MODERATION_DIGEST_TO ?? '').split(/[\s,]+/).filter((a) => EMAIL_RE.test(a))
  if (set.length) return set
  const lookup = pgRecipientLookup(pool)
  for (const did of (env.ADMIN_DIDS ?? '').split(/[\s,]+/).filter((d) => DID_RE.test(d))) {
    const to = await lookup(did)
    if (to) return [to]
  }
  return []
}

export type DigestRun = 'early' | 'already' | 'no_recipient' | 'quiet' | 'sent' | 'failed'

/**
 * Sends the daily moderation digest at most once per UTC day, from MODERATION_DIGEST_HOUR_UTC (default 13) on. A row in
 * moderation_digest_runs claims the day, so a restart or a second instance does not send twice. When every figure is zero the
 * email is skipped unless MODERATION_DIGEST_ALWAYS is set to 1 or true. A failed send releases the day so the next check retries.
 */
export async function runModerationDigest(pool: pg.Pool, sender: EmailSender, env: Env = process.env, now: Date = new Date()): Promise<DigestRun> {
  const hour = Number(env.MODERATION_DIGEST_HOUR_UTC ?? 13)
  if (now.getUTCHours() < (Number.isFinite(hour) ? hour : 13)) return 'early'
  const day = now.toISOString().slice(0, 10)
  const claim = await pool.query('INSERT INTO moderation_digest_runs (run_day) VALUES ($1) ON CONFLICT DO NOTHING RETURNING run_day', [day])
  if (!claim.rowCount) return 'already'
  try {
    const digest = await buildDigest(pool, slaHours(env), now)
    if (digestIsQuiet(digest) && !['1', 'true'].includes((env.MODERATION_DIGEST_ALWAYS ?? '').toLowerCase())) return 'quiet'
    const to = await digestRecipients(pool, env)
    if (!to.length) {
      log.warn('moderation digest not sent: set MODERATION_DIGEST_TO, or ADMIN_DIDS with an account that has an email on file')
      return 'no_recipient'
    }
    const mail = formatDigest(digest, env.PUBLIC_URL ?? 'https://blueyvatar.com')
    for (const a of to) await sender.send({ to: a, ...mail })
    await pool.query('UPDATE moderation_digest_runs SET sent = true WHERE run_day = $1', [day])
    return 'sent'
  } catch (err) {
    await pool.query('DELETE FROM moderation_digest_runs WHERE run_day = $1', [day]).catch(() => {})
    log.error('moderation digest failed', { err })
    errors.captureException(err, { tags: { task: 'moderation_digest' } })
    return 'failed'
  }
}

/** Checks every 15 minutes and sends once per day. Runs in the indexer because it is always on; the web and delivery apps scale to zero. */
export function scheduleModerationDigest(pool: pg.Pool, env: Env = process.env, sender: EmailSender = emailSender(env), everyMs = 15 * 60_000): NodeJS.Timeout {
  const run = () => void runModerationDigest(pool, sender, env).then((r) => { if (r === 'sent' || r === 'failed') log.info('moderation digest', { result: r }) })
  run()
  const timer = setInterval(run, everyMs)
  timer.unref()
  return timer
}
