import { effectOfferNotice, emailSender, Notifier, pgNoticeDirectory, type EmailSender } from '@blueyvatar/core/verification'
import type pg from 'pg'
import { job, type JobFactory } from './jobs/schedule.js'
import { errors } from './obs.js'
import { publicUrl } from './public-url.js'

type Env = Record<string, string | undefined>

/** At most this many emails per offer per run, so a large audience spreads over a few runs. */
const OFFER_BATCH = 100

type OfferRun = { offers: number; sent: number; skipped: number; failed: number }

type Offer = { id: number; name: string; ends_at: Date; audience: 'everyone' | 'plan' | 'accounts'; plan_name: 'free' | 'plus' | null }

/** Accounts with Plus: a manual grant in PLUS_DIDS, or a subscription that entitles (same rule as the web app's hasPlus). */
const plusSql = (col: string) => `(${col} = ANY($3::text[]) OR ${col} IN (
  SELECT s.did FROM subscriptions s WHERE s.status IN ('active', 'trialing', 'past_due')
    AND (s.tier IN ('plus', 'pro') OR s.license_id IN (SELECT license_id FROM licenses WHERE owner = s.did AND org_id IS NULL))))`

async function candidates(pool: pg.Pool, o: Offer, plusDids: string[]): Promise<string[]> {
  const left = 'LEFT JOIN effect_offer_users u ON u.offer_id = $1 AND u.did = n.did'
  if (o.audience === 'accounts') {
    const r = await pool.query<{ did: string }>('SELECT did FROM effect_offer_users WHERE offer_id = $1 AND listed AND emailed_at IS NULL ORDER BY did LIMIT $2', [o.id, OFFER_BATCH])
    return r.rows.map((x) => x.did)
  }
  if (o.audience === 'everyone') {
    const r = await pool.query<{ did: string }>(`SELECT n.did FROM notice_emails n ${left} WHERE u.emailed_at IS NULL ORDER BY n.did LIMIT $2`, [o.id, OFFER_BATCH])
    return r.rows.map((x) => x.did)
  }
  const plusFilter = plusSql('n.did')
  const r = await pool.query<{ did: string }>(
    `SELECT n.did FROM notice_emails n ${left} WHERE u.emailed_at IS NULL AND ${o.plan_name === 'plus' ? '' : 'NOT '}${plusFilter} ORDER BY n.did LIMIT $2`,
    [o.id, OFFER_BATCH, plusDids],
  )
  return r.rows.map((x) => x.did)
}

/**
 * One email per eligible account when a free effect offer with notify turned on has started (issue #308). Each account is
 * claimed in effect_offer_users (emailed_at) before the send, so a restart or second instance never sends twice; a failed
 * send releases the claim for the next run. Offers that ended early or are over are skipped. Accounts with no address on
 * file or with offer emails switched off are counted as skipped and not retried. Once nobody is left, notify_done_at is set.
 */
export async function runEffectOffers(pool: pg.Pool, sender: EmailSender, env: Env = process.env, now: Date = new Date()): Promise<OfferRun> {
  const out: OfferRun = { offers: 0, sent: 0, skipped: 0, failed: 0 }
  const siteUrl = publicUrl(env)
  const plusDids = (env.PLUS_DIDS ?? '').split(/[\s,]+/).filter(Boolean)
  const notifier = new Notifier(sender, pgNoticeDirectory(pool))
  const { rows: offers } = await pool.query<Offer>(
    `SELECT id::int AS id, name, ends_at, audience, plan_name FROM effect_offers
      WHERE notify AND notify_done_at IS NULL AND ended_at IS NULL AND starts_at <= $1 AND ends_at > $1 ORDER BY starts_at, id`,
    [now],
  )
  out.offers = offers.length
  for (const o of offers) {
    const dids = await candidates(pool, o, plusDids)
    if (dids.length === 0) {
      await pool.query('UPDATE effect_offers SET notify_done_at = $2 WHERE id = $1', [o.id, now])
      continue
    }
    const claimed = await pool.query<{ did: string }>(
      `INSERT INTO effect_offer_users (offer_id, did, emailed_at) SELECT $1, d, $3 FROM unnest($2::text[]) d
         ON CONFLICT (offer_id, did) DO UPDATE SET emailed_at = EXCLUDED.emailed_at WHERE effect_offer_users.emailed_at IS NULL RETURNING did`,
      [o.id, dids, now],
    )
    for (const { did } of claimed.rows) {
      const res = await notifier.send(did, 'offers', effectOfferNotice({ did, name: o.name, endsAt: o.ends_at, publicUrl: siteUrl }))
      if (res === 'sent') out.sent++
      else if (res === 'failed') {
        out.failed++
        await pool.query('UPDATE effect_offer_users SET emailed_at = NULL WHERE offer_id = $1 AND did = $2', [o.id, did]).catch((err) => errors.captureException(err, { tags: { task: 'effect_offers' } }))
      } else out.skipped++
    }
  }
  return out
}

/** Checks every 5 minutes. Runs in the indexer because it is always on; the web app scales to zero. */
export const effectOffersJob: JobFactory = (pool, env = process.env) => {
  const sender = emailSender(env)
  return job({ name: 'effect_offers', everyMs: 5 * 60_000, run: () => runEffectOffers(pool, sender, env), summarize: (r) => (r.sent || r.failed) && r })
}
