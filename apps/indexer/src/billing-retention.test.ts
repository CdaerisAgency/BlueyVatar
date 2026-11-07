import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { purgeExpiredBilling } from './billing-retention.js'

const url = process.env.TEST_DATABASE_URL
const schema = `t_retention_${process.pid}_${Date.now()}`
const mig = (n: string) => readFileSync(new URL(`../../../db/migrations/${n}.sql`, import.meta.url), 'utf8')
const NOW = new Date('2033-06-01T00:00:00Z')

describe.skipIf(!url)('billing retention purge', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const n of ['0001_init', '0015_billing', '0017_plus_subscriptions', '0021_account_deletion']) await pool.query(mig(n))
    await pool.query("INSERT INTO billing_customers (did, license_id, stripe_customer_id, deleted_at) VALUES ('did:plc:old', 'lic_x', 'cus_old', '2026-05-31T00:00:00Z'), ('did:plc:new', 'lic_y', 'cus_new', '2026-06-02T00:00:00Z'), ('did:plc:live', 'lic_z', 'cus_live', NULL)")
    const sub = (id: string, cus: string, did: string, del: string | null) =>
      pool.query("INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, did, license_id, price_id, tier, status, last_event_at, deleted_at) VALUES ($1, $2, $3, 'lic_x', 'price', 'pro', 'canceled', now(), $4)", [id, cus, did, del])
    await sub('sub_old', 'cus_old', 'did:plc:old', '2026-05-31T00:00:00Z')
    await sub('sub_new', 'cus_new', 'did:plc:new', '2026-06-02T00:00:00Z')
    await sub('sub_live', 'cus_live', 'did:plc:live', null)
    await pool.query("INSERT INTO stripe_events (event_id, type, processed_at) VALUES ('evt_old', 't', '2026-01-01T00:00:00Z'), ('evt_new', 't', '2030-01-01T00:00:00Z')")
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })

  it('deletes rows more than 7 years past deletion and keeps the rest', async () => {
    expect(await purgeExpiredBilling(pool, NOW)).toEqual({ customers: 1, subscriptions: 1, events: 1 })
    const ids = async (sql: string) => (await pool.query(sql)).rows.map((r) => Object.values(r)[0]).sort()
    expect(await ids('SELECT did FROM billing_customers')).toEqual(['did:plc:live', 'did:plc:new'])
    expect(await ids('SELECT stripe_subscription_id FROM subscriptions')).toEqual(['sub_live', 'sub_new'])
    expect(await ids('SELECT event_id FROM stripe_events')).toEqual(['evt_new'])
  })

  it('is idempotent', async () => {
    expect(await purgeExpiredBilling(pool, NOW)).toEqual({ customers: 0, subscriptions: 0, events: 0 })
  })
})
