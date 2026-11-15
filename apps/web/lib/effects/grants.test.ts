import { describe, expect, it } from 'vitest'
import { canUse } from './catalog'
import { activeGrants, changeOffer, createOffer, dismissOffer, endOffer, listOffers, offersFor, parseOffer, type OfferInput } from './grants'
import { testDbUrl, useSchema } from '../testing/pg-schema'

const ADMIN = 'did:plc:admin'
const A = 'did:plc:alice'
const B = 'did:plc:bob'
const NOW = new Date('2026-12-10T12:00:00Z')
const base: OfferInput = { effect: 'frame:ring', name: 'Winter ring', startDay: '2026-12-01', endDay: '2026-12-31', audience: 'everyone', planName: '', accounts: '', notify: false }

describe.skipIf(!testDbUrl)('free effect offers', () => {
  const pool = useSchema('grants', {
    migrations: 'all',
    setup: async (p) => {
      await p.query("INSERT INTO repos (did, handle, active) VALUES ($1, 'alice.test', true)", [A])
    },
  })
  const make = async (over: Partial<OfferInput> = {}) => {
    const p = await parseOffer(pool, { ...base, ...over }, NOW)
    if (!p.ok) throw new Error(p.error)
    return createOffer(pool, ADMIN, p.value)
  }
  const audit = async (id: number) => (await pool.query("SELECT action, actor FROM admin_actions WHERE action LIKE 'effect_offer_%' AND (detail->>'offerId')::int = $1 ORDER BY id", [id])).rows as { action: string; actor: string }[]


  it('validates the form', async () => {
    const bad = async (over: Partial<OfferInput>) => (await parseOffer(pool, { ...base, ...over }, NOW)).ok
    expect(await bad({})).toBe(true)
    expect(await bad({ effect: 'badge:away' })).toBe(false)
    expect(await bad({ effect: 'nope' })).toBe(false)
    expect(await bad({ name: ' ' })).toBe(false)
    expect(await bad({ startDay: '2026-12-31', endDay: '2026-12-01' })).toBe(false)
    expect(await bad({ startDay: '2026-02-30' })).toBe(false)
    expect(await bad({ startDay: '2026-01-01', endDay: '2026-01-02' })).toBe(false)
    expect(await bad({ audience: 'plan', planName: 'gold' })).toBe(false)
    expect(await bad({ audience: 'accounts', accounts: 'ghost.test' })).toBe(false)
    expect(await bad({ audience: 'accounts', accounts: '' })).toBe(false)
  })

  it('grants everyone the effect inside the window and feeds canUse', async () => {
    await make()
    expect(await activeGrants(pool, A, 'free', NOW)).toEqual(['frame:ring'])
    expect(canUse('frame:ring', 'free', await activeGrants(pool, A, 'free', NOW))).toBe(true)
    expect(await activeGrants(pool, A, 'free', new Date('2026-11-30T23:59:59Z'))).toEqual([])
    expect(await activeGrants(pool, A, 'free', new Date('2027-01-01T00:00:00Z'))).toEqual([])
    expect(await activeGrants(pool, A, 'free', new Date('2026-12-31T23:59:59Z'))).toEqual(['frame:ring'])
  })

  it('targets a plan or listed accounts by DID or handle', async () => {
    await pool.query('DELETE FROM effect_offers')
    await make({ audience: 'plan', planName: 'plus', effect: 'frame:dashed' })
    await make({ audience: 'accounts', accounts: `alice.test\n${B}, @alice.test`, effect: 'frame:double' })
    expect((await listOffers(pool)).find((o) => o.audience === 'accounts')?.dids).toEqual([A, B])
    expect(await activeGrants(pool, A, 'free', NOW)).toEqual(['frame:double'])
    expect((await activeGrants(pool, 'did:plc:carol', 'free', NOW))).toEqual([])
    expect((await activeGrants(pool, 'did:plc:carol', 'plus', NOW)).sort()).toEqual(['frame:dashed'])
  })

  it('ending early removes the grant at once and audits create, change and end', async () => {
    await pool.query('DELETE FROM effect_offers')
    const id = await make({ notify: true })
    const p = await parseOffer(pool, { ...base, name: 'Renamed', notify: true }, NOW)
    if (!p.ok) throw new Error(p.error)
    expect((await changeOffer(pool, ADMIN, id, p.value)).ok).toBe(true)
    expect((await offersFor(pool, A, 'free', NOW))[0]).toMatchObject({ name: 'Renamed', notify: true })
    expect((await endOffer(pool, ADMIN, id, NOW)).ok).toBe(true)
    expect(await activeGrants(pool, A, 'free', NOW)).toEqual([])
    expect((await endOffer(pool, ADMIN, id, NOW)).ok).toBe(false)
    expect((await changeOffer(pool, ADMIN, id, p.value)).ok).toBe(false)
    expect((await audit(id)).map((a) => a.action)).toEqual(['effect_offer_create', 'effect_offer_change', 'effect_offer_end'])
  })

  it('dismisses the banner per account and only for an offer that includes it', async () => {
    await pool.query('DELETE FROM effect_offers')
    const id = await make({ audience: 'accounts', accounts: A, notify: true })
    expect(await dismissOffer(pool, B, 'free', id, NOW)).toBe(false)
    expect(await dismissOffer(pool, A, 'free', id, NOW)).toBe(true)
    expect((await offersFor(pool, A, 'free', NOW))[0]!.dismissed).toBe(true)
  })
})
