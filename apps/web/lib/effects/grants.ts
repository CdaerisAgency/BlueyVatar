import type pg from 'pg'
import { DID_RE, inTx, recordAction } from '../admin/moderation'
import type { Plan } from '../records'
import { EFFECT_ACCESS, type Check, type EffectId } from './catalog'

/**
 * Admin-issued free effect offers (issue #308). An offer feeds the `grants` argument of `canUse` and nothing else:
 * the catalog and renderer are unchanged, and an avatar already rendered with an effect keeps working after the offer
 * ends or is ended early, because a render is an ordinary image. Dates are whole UTC days; the last day is inclusive.
 */
type Q = Pick<pg.Pool, 'query'>

export type Audience = 'everyone' | 'plan' | 'accounts'
export type Offer = {
  id: number
  effect: EffectId
  name: string
  startsAt: Date
  endsAt: Date
  audience: Audience
  planName: Plan | null
  notify: boolean
  notifyDoneAt: Date | null
  endedAt: Date | null
  createdBy: string
  dids: string[]
}
export type OfferInput = { effect: string; name: string; startDay: string; endDay: string; audience: string; planName: string; accounts: string; notify: boolean }
export type OfferValues = Omit<Offer, 'id' | 'notifyDoneAt' | 'endedAt' | 'createdBy'>

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000
const dayStart = (s: string): Date | null => (DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s) ? new Date(`${s}T00:00:00Z`) : null)

/** Effects an offer can be made for: the ones that cost something. A free effect needs no offer. */
export const offerableEffects = (): EffectId[] => (Object.keys(EFFECT_ACCESS) as EffectId[]).filter((e) => EFFECT_ACCESS[e] !== 'free')
export const isEffectId = (v: string): v is EffectId => Object.prototype.hasOwnProperty.call(EFFECT_ACCESS, v)

/** Splits pasted DIDs and handles. Handles are looked up in the indexed `repos` table; anything that does not resolve is returned for the admin to fix. */
export async function resolveAccounts(q: Q, raw: string): Promise<{ dids: string[]; unknown: string[] }> {
  const items = [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim().replace(/^@/, '')).filter(Boolean))]
  const dids = new Set<string>()
  const unknown: string[] = []
  for (const item of items) {
    if (DID_RE.test(item)) dids.add(item)
    else {
      const { rows } = await q.query<{ did: string }>('SELECT did FROM repos WHERE lower(handle) = lower($1) LIMIT 1', [item])
      if (rows[0]) dids.add(rows[0].did)
      else unknown.push(item)
    }
  }
  return { dids: [...dids], unknown }
}

/** Checks the form and resolves the account list. `now` only guards against an end day in the past. */
export async function parseOffer(q: Q, i: OfferInput, now: Date = new Date()): Promise<Check<OfferValues>> {
  if (!isEffectId(i.effect) || EFFECT_ACCESS[i.effect] === 'free') return { ok: false, error: 'Choose a paid effect.' }
  const name = i.name.trim()
  if (!name || name.length > 80) return { ok: false, error: 'Give the offer a name of up to 80 characters.' }
  const start = dayStart(i.startDay), last = dayStart(i.endDay)
  if (!start || !last) return { ok: false, error: 'Choose a first and last day.' }
  const end = new Date(last.getTime() + DAY_MS)
  if (end <= start) return { ok: false, error: 'The last day cannot be before the first day.' }
  if (end <= now) return { ok: false, error: 'The last day has already passed.' }
  if (i.audience !== 'everyone' && i.audience !== 'plan' && i.audience !== 'accounts') return { ok: false, error: 'Choose who gets it.' }
  let planName: Plan | null = null
  let dids: string[] = []
  if (i.audience === 'plan') {
    if (i.planName !== 'free' && i.planName !== 'plus') return { ok: false, error: 'Choose a plan.' }
    planName = i.planName
  }
  if (i.audience === 'accounts') {
    const r = await resolveAccounts(q, i.accounts)
    if (r.unknown.length) return { ok: false, error: `Could not find: ${r.unknown.slice(0, 5).join(', ')}. Use a DID or a handle BlueyVatar has indexed.` }
    if (r.dids.length === 0) return { ok: false, error: 'List at least one account.' }
    if (r.dids.length > 500) return { ok: false, error: 'At most 500 accounts per offer.' }
    dids = r.dids
  }
  return { ok: true, value: { effect: i.effect, name, startsAt: start, endsAt: end, audience: i.audience, planName, notify: i.notify, dids } }
}

const COLS = 'id::int AS id, effect, name, starts_at, ends_at, audience, plan_name, notify, notify_done_at, ended_at, created_by'
type Row = { id: number; effect: EffectId; name: string; starts_at: Date; ends_at: Date; audience: Audience; plan_name: Plan | null; notify: boolean; notify_done_at: Date | null; ended_at: Date | null; created_by: string }
const toOffer = (r: Row, dids: string[] = []): Offer => ({ id: r.id, effect: r.effect, name: r.name, startsAt: r.starts_at, endsAt: r.ends_at, audience: r.audience, planName: r.plan_name, notify: r.notify, notifyDoneAt: r.notify_done_at, endedAt: r.ended_at, createdBy: r.created_by, dids })

const detailOf = (v: OfferValues) => ({ effect: v.effect, name: v.name, startsAt: v.startsAt.toISOString(), endsAt: v.endsAt.toISOString(), audience: v.audience, plan: v.planName, notify: v.notify, accounts: v.dids.length })

async function setAccounts(c: Q, id: number, dids: string[]): Promise<void> {
  // Keep rows that carry an email or dismissal record, so a changed list never re-sends or re-shows.
  await c.query('UPDATE effect_offer_users SET listed = false WHERE offer_id = $1', [id])
  if (dids.length) await c.query('INSERT INTO effect_offer_users (offer_id, did, listed) SELECT $1, d, true FROM unnest($2::text[]) d ON CONFLICT (offer_id, did) DO UPDATE SET listed = true', [id, dids])
  await c.query('DELETE FROM effect_offer_users WHERE offer_id = $1 AND NOT listed AND emailed_at IS NULL AND dismissed_at IS NULL', [id])
}

export async function createOffer(pool: pg.Pool, actor: string, v: OfferValues): Promise<number> {
  return inTx(pool, async (c) => {
    const { rows } = await c.query<{ id: number }>(
      `INSERT INTO effect_offers (effect, name, starts_at, ends_at, audience, plan_name, notify, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::int AS id`,
      [v.effect, v.name, v.startsAt, v.endsAt, v.audience, v.planName, v.notify, actor],
    )
    const id = rows[0]!.id
    await setAccounts(c, id, v.dids)
    await recordAction(c, actor, 'effect_offer_create', { reason: `Effect offer ${id}: ${v.name}`, detail: { offerId: id, ...detailOf(v) } })
    return id
  })
}

/** Changes an offer that has not ended. Once the email went out (notify_done_at), the notify switch and start can no longer re-send. */
export async function changeOffer(pool: pg.Pool, actor: string, id: number, v: OfferValues): Promise<Check<null>> {
  return inTx(pool, async (c) => {
    const cur = (await c.query<Row>(`SELECT ${COLS} FROM effect_offers WHERE id = $1 FOR UPDATE`, [id])).rows[0]
    if (!cur) return { ok: false, error: 'Offer not found.' } as const
    if (cur.ended_at || cur.ends_at <= new Date()) return { ok: false, error: 'That offer has ended and cannot be changed.' } as const
    await c.query(
      `UPDATE effect_offers SET effect = $2, name = $3, starts_at = $4, ends_at = $5, audience = $6, plan_name = $7, notify = $8, updated_at = now() WHERE id = $1`,
      [id, v.effect, v.name, v.startsAt, v.endsAt, v.audience, v.planName, v.notify],
    )
    await setAccounts(c, id, v.audience === 'accounts' ? v.dids : [])
    await recordAction(c, actor, 'effect_offer_change', { reason: `Effect offer ${id}: ${v.name}`, detail: { offerId: id, before: detailOf({ ...toOffer(cur), dids: [] }), after: detailOf(v) } })
    return { ok: true, value: null } as const
  })
}

/** Ends an offer now. It leaves the effects page at once; renders made with it are untouched. */
export async function endOffer(pool: pg.Pool, actor: string, id: number, now: Date = new Date()): Promise<Check<null>> {
  return inTx(pool, async (c) => {
    const { rows } = await c.query<{ name: string }>('UPDATE effect_offers SET ended_at = $2, updated_at = $2 WHERE id = $1 AND ended_at IS NULL RETURNING name', [id, now])
    if (!rows[0]) return { ok: false, error: 'Offer not found or already ended.' } as const
    await recordAction(c, actor, 'effect_offer_end', { reason: `Effect offer ${id}: ${rows[0].name}`, detail: { offerId: id, endedAt: now.toISOString() } })
    return { ok: true, value: null } as const
  })
}

export async function listOffers(q: Q): Promise<Offer[]> {
  const { rows } = await q.query<Row & { dids: string[] | null }>(
    `SELECT ${COLS}, (SELECT array_agg(did ORDER BY did) FROM effect_offer_users u WHERE u.offer_id = o.id AND u.listed) AS dids FROM effect_offers o ORDER BY starts_at DESC, id DESC LIMIT 200`,
  )
  return rows.map((r) => toOffer(r, r.dids ?? []))
}

export async function getOffer(q: Q, id: number): Promise<Offer | null> {
  return (await listOffers(q)).find((o) => o.id === id) ?? null
}

/** An offer is live when started, not over, and not ended early. */
export const isLive = (o: Pick<Offer, 'startsAt' | 'endsAt' | 'endedAt'>, now: Date): boolean => !o.endedAt && o.startsAt <= now && now < o.endsAt

export type MyOffer = { id: number; effect: EffectId; name: string; endsAt: Date; notify: boolean; dismissed: boolean }

/** Live offers that include this account, for the grants list, the effects page section, and the banner. */
export async function offersFor(q: Q, did: string, plan: Plan, now: Date = new Date()): Promise<MyOffer[]> {
  const { rows } = await q.query<{ id: number; effect: EffectId; name: string; ends_at: Date; notify: boolean; dismissed_at: Date | null }>(
    `SELECT o.id::int AS id, o.effect, o.name, o.ends_at, o.notify, u.dismissed_at
       FROM effect_offers o LEFT JOIN effect_offer_users u ON u.offer_id = o.id AND u.did = $1
      WHERE o.ended_at IS NULL AND o.starts_at <= $3 AND o.ends_at > $3
        AND (o.audience = 'everyone' OR (o.audience = 'plan' AND o.plan_name = $2) OR (o.audience = 'accounts' AND u.listed))
      ORDER BY o.ends_at, o.id`,
    [did, plan, now],
  )
  return rows.map((r) => ({ id: r.id, effect: r.effect, name: r.name, endsAt: r.ends_at, notify: r.notify, dismissed: r.dismissed_at !== null }))
}

/** The `grants` argument for `canUse(effect, plan, grants)`. */
export async function activeGrants(q: Q, did: string, plan: Plan, now: Date = new Date()): Promise<EffectId[]> {
  return [...new Set((await offersFor(q, did, plan, now)).map((o) => o.effect))]
}

/** Hides the banner for one offer. Only an offer that includes the account can be dismissed. */
export async function dismissOffer(q: Q, did: string, plan: Plan, offerId: number, now: Date = new Date()): Promise<boolean> {
  if (!(await offersFor(q, did, plan, now)).some((o) => o.id === offerId)) return false
  await q.query(
    'INSERT INTO effect_offer_users (offer_id, did, dismissed_at) VALUES ($1, $2, $3) ON CONFLICT (offer_id, did) DO UPDATE SET dismissed_at = $3',
    [offerId, did, now],
  )
  return true
}
