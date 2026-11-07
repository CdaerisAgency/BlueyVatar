import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkUploadForm } from './upload-caps'
import {
  BUCKETS, checkLimits, clientIp, formatRetry, isLockedOut, limitedMessage, limitedResponse, memoryRateStore, pgRateStore, recordFailure,
  type BucketName, type RateStore,
} from './rate-limit'

const headers = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null })

describe('clientIp', () => {
  it('trusts CF-Connecting-IP only with the origin secret', () => {
    expect(clientIp(headers({ 'cf-connecting-ip': '1.2.3.4', 'x-origin-auth': 's3' }), 's3')).toBe('1.2.3.4')
    expect(clientIp(headers({ 'cf-connecting-ip': '1.2.3.4' }), 's3')).toBe('unknown')
    expect(clientIp(headers({ 'cf-connecting-ip': '1.2.3.4', 'x-origin-auth': 'nope' }), 's3')).toBe('unknown')
    expect(clientIp(headers({ 'cf-connecting-ip': '1.2.3.4', 'x-origin-auth': 'x' }), undefined)).toBe('unknown')
  })
  it('falls back to Fly-Client-IP and ignores X-Forwarded-For', () => {
    expect(clientIp(headers({ 'fly-client-ip': '9.9.9.9', 'x-forwarded-for': '6.6.6.6' }), 's3')).toBe('9.9.9.9')
    expect(clientIp(headers({ 'x-forwarded-for': '6.6.6.6' }), 's3')).toBe('unknown')
  })
})

describe('messages', () => {
  it('rounds the retry time up', () => {
    expect(formatRetry(1)).toBe('1 second')
    expect(formatRetry(45)).toBe('45 seconds')
    expect(formatRetry(61)).toBe('2 minutes')
    expect(formatRetry(3599)).toBe('60 minutes')
    expect(formatRetry(3600)).toBe('1 hour')
    expect(formatRetry(3601)).toBe('2 hours')
    expect(limitedMessage(180)).toBe('Too many requests. Try again in 3 minutes.')
  })
  it('answers 429 with Retry-After', async () => {
    const r = limitedResponse(42)
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toBe('42')
    expect(await r.text()).toContain('42 seconds')
  })
})

/** Runs the same bucket checks against any store, so memory and Postgres behave alike. */
function suite(make: () => RateStore) {
  const names = (Object.keys(BUCKETS) as BucketName[]).filter((n) => !n.endsWith('Fail.ip') && !n.endsWith('Fail.did'))
  it.each(names)('bucket %s allows its limit, refuses the next, and resets after the window', async (name) => {
    const store = make()
    const { limit, windowSec } = BUCKETS[name]
    const who = { ip: `ip-${name}`, did: `did:plc:${name.replace('.', '')}` }
    const t0 = new Date('2026-01-01T00:00:00Z')
    for (let i = 0; i < limit; i++) expect((await checkLimits(store, [name], who, t0)).ok).toBe(true)
    const over = await checkLimits(store, [name], who, new Date(t0.getTime() + 1000))
    expect(over).toEqual({ ok: false, bucket: name, retryAfterSec: windowSec - 1 })
    // Another subject is unaffected.
    expect((await checkLimits(store, [name], { ip: 'other', did: 'did:plc:other' }, t0)).ok).toBe(true)
    // The window ends: the counter starts over.
    expect((await checkLimits(store, [name], who, new Date(t0.getTime() + windowSec * 1000 + 1))).ok).toBe(true)
  })

  it('skips a bucket whose subject is missing and reports the longest wait', async () => {
    const store = make()
    const t0 = new Date('2026-01-01T00:00:00Z')
    expect((await checkLimits(store, ['key.did'], { ip: '1.1.1.1' }, t0)).ok).toBe(true)
    for (let i = 0; i < BUCKETS['addEmail.did'].limit + 1; i++) await checkLimits(store, ['addEmail.did', 'addEmail.ip'], { ip: 'a', did: 'd' }, t0)
    const r = await checkLimits(store, ['addEmail.ip', 'addEmail.did'], { ip: 'a', did: 'd' }, t0)
    expect(r).toMatchObject({ ok: false, bucket: 'addEmail.did', retryAfterSec: 3600 })
  })

  it('locks out after the failure limit and frees after the window', async () => {
    const store = make()
    const who = { ip: 'z', did: 'did:plc:z' }
    const t0 = new Date('2026-01-01T00:00:00Z')
    for (let i = 0; i < BUCKETS['codeFail.did'].limit - 1; i++) await recordFailure(store, 'codeFail.did', who, t0)
    expect((await isLockedOut(store, 'codeFail.did', who, t0)).ok).toBe(true)
    await recordFailure(store, 'codeFail.did', who, t0)
    expect(await isLockedOut(store, 'codeFail.did', who, new Date(t0.getTime() + 10_000))).toEqual({ ok: false, bucket: 'codeFail.did', retryAfterSec: 3590 })
    expect((await isLockedOut(store, 'codeFail.did', who, new Date(t0.getTime() + 3601_000))).ok).toBe(true)
    for (let i = 0; i < BUCKETS['loginFail.ip'].limit; i++) await recordFailure(store, 'loginFail.ip', who, t0)
    expect((await isLockedOut(store, 'loginFail.ip', who, t0)).ok).toBe(false)
  })

  it('stores no raw IP or DID in the bucket key', async () => {
    const seen: string[] = []
    const inner = make()
    const spy: RateStore = { hit: (b, w, n) => (seen.push(b), inner.hit(b, w, n)), peek: (b, n) => inner.peek(b, n) }
    await checkLimits(spy, ['key.did', 'key.ip'], { ip: '203.0.113.7', did: 'did:plc:secretish' })
    expect(seen).toHaveLength(2)
    for (const k of seen) expect(k).toMatch(/^web:key\.(did|ip):[0-9a-f]{64}$/)
  })
}

describe('memory store', () => suite(() => memoryRateStore()))

const url = process.env.TEST_DATABASE_URL
const schema = `t_rate_${process.pid}_${Date.now()}`
describe.skipIf(!url)('Postgres store (rate_windows)', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    await pool.query(readFileSync(new URL('../../../db/migrations/0001_init.sql', import.meta.url), 'utf8'))
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })
  suite(() => pgRateStore(pool))
  it('shares counts across store instances', async () => {
    const t0 = new Date('2026-02-01T00:00:00Z')
    const a = pgRateStore(pool)
    const b = pgRateStore(pool)
    await a.hit('web:shared', 60, t0)
    expect((await b.hit('web:shared', 60, t0)).count).toBe(2)
  })
})

describe('upload caps', () => {
  const file = (n: number) => new File([new Uint8Array(n)], 'a.png', { type: 'image/png' })
  it('requires exactly one non-empty file within the size cap', () => {
    const one = new FormData()
    one.append('file', file(10))
    expect(checkUploadForm(one).ok).toBe(true)
    expect(checkUploadForm(new FormData()).ok).toBe(false)
    const empty = new FormData()
    empty.append('file', file(0))
    expect(checkUploadForm(empty).ok).toBe(false)
    const big = new FormData()
    big.append('file', file(1_000_001))
    expect(checkUploadForm(big)).toMatchObject({ ok: false })
    const two = new FormData()
    two.append('file', file(5))
    two.append('file', file(5))
    expect(checkUploadForm(two)).toEqual({ ok: false, error: 'Upload one image at a time.' })
  })
})
