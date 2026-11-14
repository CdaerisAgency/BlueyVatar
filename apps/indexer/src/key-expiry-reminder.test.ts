import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptJson } from '@blueyvatar/core/verification'
import { KEY_REMINDER_DAYS, runKeyExpiryReminders } from './key-expiry-reminder.js'

const url = process.env.TEST_DATABASE_URL
const schema = `t_keyrem_${process.pid}_${Date.now()}`
const NOW = new Date('2026-11-14T12:00:00Z')
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000)
const DID = 'did:plc:owner'
const ENV = { PUBLIC_URL: 'https://blueyvatar.test' }

describe.skipIf(!url)('key expiry reminders', () => {
  let pool: pg.Pool
  const send = vi.fn(async (_m: { to: string; subject: string; text: string }) => {})
  const sender = { send }
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const dir = new URL('../../../db/migrations/', import.meta.url)
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await pool.query(readFileSync(new URL(f, dir), 'utf8'))
    const key = Buffer.alloc(32, 9)
    process.env.TOKEN_ENCRYPTION_KEY = key.toString('base64')
    await pool.query('INSERT INTO notice_emails (did, email_hash, email_enc) VALUES ($1, $2, $3)', [DID, 'b'.repeat(64), encryptJson('owner@example.test', key)])
    await pool.query("INSERT INTO licenses (license_id, owner, tier) VALUES ('lic1', $1, 'free')", [DID])
  })
  afterAll(async () => {
    delete process.env.TOKEN_ENCRYPTION_KEY
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })
  beforeEach(async () => {
    send.mockReset()
    send.mockResolvedValue(undefined)
    await pool.query('DELETE FROM api_keys')
  })
  let n = 0
  const addKey = (label: string, expiresAt: Date | null, extra = '') =>
    pool.query(
      `INSERT INTO api_keys (key_hash, prefix, license_id, kind, label, expires_at ${extra ? ', revoked_at' : ''}) VALUES ($1, $2, 'lic1', 'secret', $3, $4 ${extra ? ', now()' : ''})`,
      [String(++n).padStart(64, '0'), `sk_${n}`, label, expiresAt],
    )
  const reminded = async (label: string) => (await pool.query('SELECT expiry_reminded_at FROM api_keys WHERE label = $1', [label])).rows[0].expiry_reminded_at as Date | null

  it('uses a 7 day window', () => expect(KEY_REMINDER_DAYS).toBe(7))

  it('sends one reminder to the owner for a key expiring inside the window, and never again', async () => {
    await addKey('Soon', inDays(6))
    expect(await runKeyExpiryReminders(pool, sender, ENV, NOW)).toEqual({ sent: 1, skipped: 0, failed: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    const m = send.mock.calls[0]![0]
    expect(m.to).toBe('owner@example.test')
    expect(m.subject).toBe('Your BlueyVatar key "Soon" expires on 2026-11-20')
    expect(await reminded('Soon')).not.toBeNull()
    expect(await runKeyExpiryReminders(pool, sender, ENV, inDays(1))).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('skips Forever keys, keys outside the window, revoked keys and keys already expired', async () => {
    await addKey('Forever', null)
    await addKey('Later', inDays(8))
    await addKey('Revoked', inDays(3), 'revoked')
    await addKey('Expired', inDays(-1))
    expect(await runKeyExpiryReminders(pool, sender, ENV, NOW)).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(await reminded('Later')).toBeNull()
  })

  it('reminds a key when it enters the window later', async () => {
    await addKey('Later', inDays(8))
    await runKeyExpiryReminders(pool, sender, ENV, NOW)
    expect(send).not.toHaveBeenCalled()
    expect((await runKeyExpiryReminders(pool, sender, ENV, inDays(2))).sent).toBe(1)
  })

  it('releases the claim when the send fails so the next run retries', async () => {
    await addKey('Flaky', inDays(2))
    send.mockRejectedValueOnce(new Error('smtp down'))
    expect(await runKeyExpiryReminders(pool, sender, ENV, NOW)).toEqual({ sent: 0, skipped: 0, failed: 1 })
    expect(await reminded('Flaky')).toBeNull()
    expect((await runKeyExpiryReminders(pool, sender, ENV, NOW)).sent).toBe(1)
  })
})
