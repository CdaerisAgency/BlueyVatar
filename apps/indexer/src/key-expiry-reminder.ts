import { keyExpiringNotice, Notifier, pgNoticeDirectory, emailSender, type EmailSender } from '@blueyvatar/core/verification'
import type pg from 'pg'
import { errors, log } from './obs.js'

type Env = Record<string, string | undefined>

/** How long before expiry the one reminder goes out. */
export const KEY_REMINDER_DAYS = 7
const DAY = 86_400_000

export type ReminderRun = { sent: number; skipped: number; failed: number }

/**
 * Emails the key owner once, KEY_REMINDER_DAYS (7) before an expiring key stops working. A key is claimed by setting
 * expiry_reminded_at in a single UPDATE, so a restart or second instance does not send twice. Keys with no expiry
 * (Forever), revoked keys and keys already past expiry are never selected. A failed send releases the claim so the next run retries.
 */
export async function runKeyExpiryReminders(pool: pg.Pool, sender: EmailSender, env: Env = process.env, now: Date = new Date()): Promise<ReminderRun> {
  const out: ReminderRun = { sent: 0, skipped: 0, failed: 0 }
  const publicUrl = env.PUBLIC_URL ?? 'https://blueyvatar.com'
  const notifier = new Notifier(sender, pgNoticeDirectory(pool))
  const claimed = await pool.query(
    `UPDATE api_keys k SET expiry_reminded_at = $1
       FROM licenses l
      WHERE l.license_id = k.license_id AND k.expires_at IS NOT NULL AND k.expiry_reminded_at IS NULL AND k.revoked_at IS NULL
        AND k.expires_at > $1 AND k.expires_at <= $2
      RETURNING k.key_hash, k.prefix, k.label, k.kind, k.created_at, k.expires_at, l.owner`,
    [now, new Date(now.getTime() + KEY_REMINDER_DAYS * DAY)],
  )
  for (const r of claimed.rows) {
    const res = await notifier.send(
      r.owner as string,
      'security',
      keyExpiringNotice({ did: r.owner, prefix: r.prefix, label: r.label, kind: r.kind, createdAt: r.created_at, expiresAt: r.expires_at, publicUrl }),
    )
    if (res === 'sent') out.sent++
    else if (res === 'failed') {
      out.failed++
      await pool.query('UPDATE api_keys SET expiry_reminded_at = NULL WHERE key_hash = $1', [r.key_hash]).catch((err) => errors.captureException(err, { tags: { task: 'key_expiry_reminder' } }))
    } else out.skipped++
  }
  return out
}

/** Checks hourly. Runs in the indexer because it is always on; the web and delivery apps scale to zero. */
export function scheduleKeyExpiryReminders(pool: pg.Pool, env: Env = process.env, sender: EmailSender = emailSender(env), everyMs = 60 * 60_000): NodeJS.Timeout {
  const run = () =>
    void runKeyExpiryReminders(pool, sender, env)
      .then((r) => { if (r.sent || r.failed) log.info('key expiry reminders', r) })
      .catch((err) => {
        log.error('key expiry reminders failed', { err })
        errors.captureException(err, { tags: { task: 'key_expiry_reminder' } })
      })
  run()
  const timer = setInterval(run, everyMs)
  timer.unref()
  return timer
}
