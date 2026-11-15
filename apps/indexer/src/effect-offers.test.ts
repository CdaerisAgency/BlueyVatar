import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runEffectOffers } from './effect-offers.js'

const url = process.env.TEST_DATABASE_URL
const schema = `t_offers_${process.pid}_${Date.now()}`
const NOW = new Date('2026-12-10T12:00:00Z')
const dids = ['did:plc:a', 'did:plc:b', 'did:plc:c']

describe.skipIf(!url)('effect offer emails', () => {
  let pool: pg.Pool
  const sent: { to: string; subject: string; text: string }[] = []
  const sender = { send: async (m: { to: string; subject: string; text: string }) => void sent.push(m) }
  const offer = async (cols: string) => (await pool.query(`INSERT INTO effect_offers (effect, name, starts_at, ends_at, created_by, ${cols.split('|')[0]}) VALUES ('frame:ring', 'Winter ring', '2026-12-01', '2027-01-01', 'admin', ${cols.split('|')[1]}) RETURNING id::int AS id`)).rows[0].id as number

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const dir = new URL('../../../db/migrations/', import.meta.url)
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await pool.query(readFileSync(new URL(f, dir), 'utf8'))
    // Real encryption needs a key; the notifier reads addresses through pgNoticeDirectory, so use a fake directory table value per test below.
  })
  afterAll(async () => {
    await pool?.end()
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  })

  it('sends once per eligible account, honors the opt-out, skips quiet and ended offers', async () => {
    const { encryptJson } = await import('@blueyvatar/core/verification')
    for (const d of dids) await pool.query("INSERT INTO notice_emails (did, email_hash, email_enc) VALUES ($1, repeat('a', 64), $2)", [d, encryptJson(`${d.slice(8)}@example.com`)])
    await pool.query("INSERT INTO notification_prefs (did, offer_notices) VALUES ('did:plc:b', false)")
    const quiet = await offer("audience, notify|'everyone', false")
    const ended = await offer("audience, notify, ended_at|'everyone', true, now()")
    const loud = await offer("audience, notify|'everyone', true")
    const r1 = await runEffectOffers(pool, sender, {}, NOW)
    expect(r1).toMatchObject({ offers: 1, sent: 2, skipped: 1, failed: 0 })
    expect(sent.map((m) => m.to).sort()).toEqual(['a@example.com', 'c@example.com'])
    expect(sent[0]!.subject).toContain('Winter ring')
    expect(sent[0]!.text).toContain('Account: did:plc:')
    expect(sent[0]!.text).toContain('/account/notifications')
    // A second run finds nobody left and marks the offer done; nothing is sent twice.
    await runEffectOffers(pool, sender, {}, NOW)
    expect(sent).toHaveLength(2)
    expect((await pool.query('SELECT notify_done_at FROM effect_offers WHERE id = $1', [loud])).rows[0].notify_done_at).not.toBeNull()
    expect((await pool.query('SELECT notify_done_at FROM effect_offers WHERE id = ANY($1)', [[quiet, ended]])).rows.every((x) => x.notify_done_at === null)).toBe(true)
  })

  it('emails only the plan or listed accounts', async () => {
    sent.length = 0
    await pool.query('DELETE FROM effect_offers')
    const plan = await offer("audience, plan_name, notify|'plan', 'plus', true")
    const r = await runEffectOffers(pool, sender, { PLUS_DIDS: 'did:plc:c' }, NOW)
    expect(r.sent).toBe(1)
    expect(sent[0]!.to).toBe('c@example.com')
    await pool.query('UPDATE effect_offers SET ended_at = now() WHERE id = $1', [plan])
    const list = await offer("audience, notify|'accounts', true")
    await pool.query("INSERT INTO effect_offer_users (offer_id, did, listed) VALUES ($1, 'did:plc:a', true)", [list])
    sent.length = 0
    await runEffectOffers(pool, sender, {}, NOW)
    expect(sent.map((m) => m.to)).toEqual(['a@example.com'])
  })
})
