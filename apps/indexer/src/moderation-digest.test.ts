import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptJson } from '@blueyvatar/core/verification'
import { digestRecipients, runModerationDigest } from './moderation-digest.js'

const url = process.env.TEST_DATABASE_URL
const schema = `t_digest_${process.pid}_${Date.now()}`
const NOW = new Date('2026-11-07T14:00:00Z')
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000)
const ENV = { MODERATION_DIGEST_TO: 'owner@example.test', PUBLIC_URL: 'https://blueyvatar.test' }

describe.skipIf(!url)('moderation digest', () => {
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
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })
  beforeEach(async () => {
    send.mockClear()
    await pool.query('DELETE FROM moderation_digest_runs; DELETE FROM case_signals; DELETE FROM review_cases; DELETE FROM reports; DELETE FROM upload_scan_events; DELETE FROM notice_emails')
  })
  const report = (did: string, reason: string, at: Date) =>
    pool.query("INSERT INTO reports (target_did, source, reason, ip_hash, reporter_contact, created_at) VALUES ($1, 'avatar', $2, 'h', 'reporter@secret.test', $3)", [did, reason, at])

  it('sends counts for the last day, with the Cloudflare note and a portal link, and no identifiers or images', async () => {
    await report('did:plc:one', 'spam', ago(2))
    await report('did:plc:one', 'spam', ago(1))
    await report('did:plc:two', 'illegal', ago(3))
    await report('did:plc:old', 'harassment', ago(60))
    const scan = (service: string, outcome: string, at: Date) => pool.query("INSERT INTO upload_scan_events (did, service, outcome, flags, created_at) VALUES ('did:plc:scan', $1, $2, '{}', $3)", [service, outcome, at])
    await scan('photodna', 'match', ago(5))
    await scan('photodna', 'match', ago(6))
    await scan('photodna', 'match', ago(80))
    await scan('other', 'outage_blocked', ago(2))
    await scan('photodna', 'outage_allowed', ago(2))
    await pool.query("INSERT INTO reports (target_did, source, reason, ip_hash, origin, label_key, created_at) VALUES ('did:plc:lab', 'avatar', 'explicit', 'label', 'label', 'did:plc:labeler|at://did:plc:lab/app.bsky.actor.profile/self|porn', $1)", [ago(4)])
    await pool.query("INSERT INTO review_cases (dedupe_key, subject_did, severity, status, opened_at) VALUES ('cid:bafyescalated', 'did:plc:esc', 'high', 'escalated', $1)", [ago(40)])
    expect(await runModerationDigest(pool, sender, ENV, NOW)).toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
    const { to, subject, text } = send.mock.calls[0]![0]
    expect(to).toBe('owner@example.test')
    expect(subject).toContain('3 new reports')
    for (const part of ['spam: 2', 'illegal: 1', 'photodna, match: 2', 'other, outage_blocked: 1', 'Upload rejections: 3', 'Uploads allowed while the scanner was down: 1', 'Cases opened by labels: 1', 'Escalations waiting: 1',
      'Child-safety cases open (restricted queue): 1', 'SLA breaches (open and past due): 2', 'Oldest open case:', 'Cloudflare CSAM Scanning Tool', 'https://dash.cloudflare.com/', 'https://blueyvatar.test/admin']) {
      expect(text).toContain(part)
    }
    expect(text).not.toMatch(/did:|bafy|reporter@secret|owner@example|<img/)
    expect(text).not.toContain('harassment')
    expect((await pool.query('SELECT sent FROM moderation_digest_runs')).rows).toEqual([{ sent: true }])
  })

  it('sends once a day and not before the configured hour', async () => {
    await report('did:plc:one', 'spam', ago(1))
    expect(await runModerationDigest(pool, sender, { ...ENV, MODERATION_DIGEST_HOUR_UTC: '15' }, NOW)).toBe('early')
    expect(await runModerationDigest(pool, sender, ENV, NOW)).toBe('sent')
    expect(await runModerationDigest(pool, sender, ENV, new Date(NOW.getTime() + 3_600_000))).toBe('already')
    expect(send).toHaveBeenCalledTimes(1)
    expect(await runModerationDigest(pool, sender, ENV, new Date(NOW.getTime() + 24 * 3_600_000))).toBe('sent')
  })

  it('skips when everything is zero unless told to always send', async () => {
    expect(await runModerationDigest(pool, sender, ENV, NOW)).toBe('quiet')
    expect(send).not.toHaveBeenCalled()
    await pool.query('DELETE FROM moderation_digest_runs')
    expect(await runModerationDigest(pool, sender, { ...ENV, MODERATION_DIGEST_ALWAYS: 'true' }, NOW)).toBe('sent')
    expect(send.mock.calls[0]![0].text).toContain('New reports: 0')
  })

  it('releases the day when sending fails, so the next check retries', async () => {
    await report('did:plc:one', 'spam', ago(1))
    send.mockRejectedValueOnce(new Error('down'))
    expect(await runModerationDigest(pool, sender, ENV, NOW)).toBe('failed')
    expect(await runModerationDigest(pool, sender, ENV, NOW)).toBe('sent')
  })

  it('defaults to the first admin account that has an email on file', async () => {
    const key = Buffer.alloc(32, 7)
    process.env.TOKEN_ENCRYPTION_KEY = key.toString('base64')
    const hash = 'a'.repeat(64)
    await pool.query('INSERT INTO notice_emails (did, email_hash, email_enc) VALUES ($1, $2, $3)', ['did:plc:admin2', hash, encryptJson('admin@example.test', key)])
    const env = { ADMIN_DIDS: 'did:plc:admin1 did:plc:admin2' }
    expect(await digestRecipients(pool, env)).toEqual(['admin@example.test'])
    expect(await digestRecipients(pool, { ...env, MODERATION_DIGEST_TO: 'a@example.test, b@example.test, nope' })).toEqual(['a@example.test', 'b@example.test'])
    expect(await digestRecipients(pool, {})).toEqual([])
    await report('did:plc:one', 'spam', ago(1))
    expect(await runModerationDigest(pool, sender, { ...env, PUBLIC_URL: ENV.PUBLIC_URL }, NOW)).toBe('sent')
    expect(send.mock.calls[0]![0].to).toBe('admin@example.test')
    delete process.env.TOKEN_ENCRYPTION_KEY
  })

  it('does not send without a recipient', async () => {
    await report('did:plc:one', 'spam', ago(1))
    expect(await runModerationDigest(pool, sender, {}, NOW)).toBe('no_recipient')
    expect(send).not.toHaveBeenCalled()
  })
})
