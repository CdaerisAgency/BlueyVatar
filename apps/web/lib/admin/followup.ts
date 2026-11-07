import type pg from 'pg'
import { reportOutcomeNotice, type EmailSender } from '@blueyvatar/core/verification'
import { reportError } from '../obs'

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

export type FollowUp = { sent: number; skipped: number; failed: number }

/**
 * Tells the reporters of decided reports the outcome, when they left an email address, then deletes the stored
 * contact whether or not the send worked (spec section 9: reporter contact is kept no longer than needed).
 * Never throws, never logs an address, and never includes the admin's reason.
 */
export async function notifyReporters(
  pool: pg.Pool, sender: EmailSender, reportIds: number[], outcome: 'actioned' | 'dismissed', publicUrl: string,
): Promise<FollowUp> {
  const out: FollowUp = { sent: 0, skipped: 0, failed: 0 }
  if (reportIds.length === 0) return out
  try {
    // Clearing the column in the same statement means a concurrent decision cannot send a second message.
    const { rows } = await pool.query<{ id: number; contact: string | null }>(
      `UPDATE reports r SET reporter_contact = NULL
         FROM (SELECT id, reporter_contact FROM reports WHERE id = ANY($1::bigint[]) AND reporter_contact IS NOT NULL AND status = $2 FOR UPDATE) old
        WHERE r.id = old.id RETURNING r.id::int AS id, old.reporter_contact AS contact`,
      [reportIds, outcome],
    )
    for (const { id, contact } of rows) {
      const to = contact?.trim() ?? ''
      if (!EMAIL_RE.test(to)) { out.skipped++; continue }
      try {
        await sender.send({ to, ...reportOutcomeNotice({ reportId: id, outcome, publicUrl }) })
        out.sent++
      } catch (err) {
        reportError('reporter follow-up failed', err)
        out.failed++
      }
    }
  } catch (err) {
    reportError('reporter follow-up failed', err)
    out.failed++
  }
  return out
}
