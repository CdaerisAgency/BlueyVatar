import { describe, expect, it } from 'vitest'
import { emailHash, emailMd5 } from '@blueyvatar/core'
import { ConsoleSender, DEFAULT_FROM, ResendSender, emailSender } from './email'
import { CODE_TTL_MS, MAX_ATTEMPTS, checkCode, generateCode, hashCode, newPending } from './codes'
import { maskEmail, looksLikeEmail } from './mask'
import { isTrustedPds, linkMethod, parseTrustedHosts, pdsHost } from './pds'
import { SESSION_TTL_MS, readSession, signSession } from './session-cookie'

const DID = 'did:plc:abc123'
const HASH = 'a'.repeat(64)

describe('codes', () => {
  it('generates 6 digits', () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/)
  })
  it('stores only a sha256 of the code', () => {
    const p = newPending(DID, HASH, 'j***@e***.com', '123456', 0)
    expect(p.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(p)).not.toContain('123456')
    expect(p.codeHash).toBe(hashCode(DID, HASH, '123456'))
  })
  it('carries the MD5 of the same normalized email until the code is confirmed', () => {
    const email = ' Alice@Example.com '
    const p = newPending(DID, emailHash(email), 'a***@e***.com', '123456', 0, emailMd5(email))
    expect(p.emailMd5).toBe(emailMd5('alice@example.com'))
    expect(p.emailMd5).toMatch(/^[0-9a-f]{32}$/)
    expect(newPending(DID, HASH, 'm', '123456', 0).emailMd5).toBeUndefined()
  })
  it('accepts the right code and trims input', () => {
    const p = newPending(DID, HASH, 'm', '000042', 1000)
    expect(checkCode(p, ' 000042 ', 2000)).toEqual({ ok: true })
  })
  it('counts wrong attempts and locks after the max', () => {
    let p = newPending(DID, HASH, 'm', '111111', 0)
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const r = checkCode(p, '222222', 10)
      expect(r).toEqual({ ok: false, reason: 'wrong', attempts: i })
      p = { ...p, attempts: i }
    }
    expect(checkCode(p, '111111', 10)).toMatchObject({ ok: false, reason: 'locked' })
  })
  it('expires after 15 minutes', () => {
    const p = newPending(DID, HASH, 'm', '111111', 0)
    expect(checkCode(p, '111111', CODE_TTL_MS - 1)).toEqual({ ok: true })
    expect(checkCode(p, '111111', CODE_TTL_MS)).toMatchObject({ reason: 'expired' })
  })
  it('binds the code to the DID', () => {
    const p = newPending(DID, HASH, 'm', '111111', 0)
    expect(checkCode({ ...p, did: 'did:plc:other' }, '111111', 1)).toMatchObject({ ok: false })
  })
})

describe('pds trust', () => {
  it('parses the env list', () => {
    expect(parseTrustedHosts(' Bsky.Social, ,pds.example.com')).toEqual(['bsky.social', 'pds.example.com'])
    expect(parseTrustedHosts(undefined)).toEqual([])
  })
  it('extracts hosts', () => {
    expect(pdsHost('https://PDS.example.com:8443/x')).toBe('pds.example.com')
    expect(pdsHost('nope')).toBeNull()
  })
  it('trusts only listed hosts', () => {
    expect(isTrustedPds('a.com', ['a.com'])).toBe(true)
    expect(isTrustedPds('b.com', ['a.com'])).toBe(false)
    expect(isTrustedPds(null, ['a.com'])).toBe(false)
  })
  it('uses the code method unless confirmed on a trusted host', () => {
    const trusted = ['a.com']
    expect(linkMethod({ emailConfirmed: true, host: 'a.com', trusted })).toBe('trusted_pds')
    expect(linkMethod({ emailConfirmed: false, host: 'a.com', trusted })).toBe('code')
    expect(linkMethod({ emailConfirmed: true, host: 'b.com', trusted })).toBe('code')
    expect(linkMethod({ emailConfirmed: true, host: 'a.com', trusted: [] })).toBe('code')
  })
})

describe('mask', () => {
  it('masks local part and domain name', () => {
    expect(maskEmail('Jane.Doe@example.co.uk')).toBe('J***@e***.co.uk')
    expect(maskEmail('x@y')).toBe('x***@y***')
  })
  it('checks shape', () => {
    expect(looksLikeEmail('a@b.co')).toBe(true)
    expect(looksLikeEmail('a b@c.co')).toBe(false)
    expect(looksLikeEmail('nope')).toBe(false)
  })
})

describe('session cookie', () => {
  it('round-trips a DID', () => {
    const c = signSession(DID, 's3cret', 1000)
    expect(readSession(c, 's3cret', 2000)).toBe(DID)
  })
  it('rejects tampering, wrong secret, and expiry', () => {
    const c = signSession(DID, 's3cret', 1000)
    expect(readSession(c.replace('abc123', 'abc124'), 's3cret', 2000)).toBeNull()
    expect(readSession(c, 'other', 2000)).toBeNull()
    expect(readSession(c, 's3cret', 1000 + SESSION_TTL_MS)).toBeNull()
    expect(readSession(undefined, 's3cret', 0)).toBeNull()
    expect(readSession('junk', 's3cret', 0)).toBeNull()
  })
})

describe('resend sender', () => {
  it('posts to Resend with the key and default from', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    await new ResendSender('re_key', DEFAULT_FROM, f).send({ to: 'a@b.co', subject: 's', text: 't' })
    expect(calls[0]?.url).toBe('https://api.resend.com/emails')
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer re_key')
    expect(JSON.parse(String(calls[0]?.init.body)).from).toBe('blueyvatar <support@blueyvatar.com>')
  })
  it('throws without leaking the address on failure', async () => {
    const f = (async () => new Response('bad a@b.co', { status: 422 })) as unknown as typeof fetch
    await expect(new ResendSender('k', 'f', f).send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toThrow(/422$/)
  })
  it('falls back to console without a key', () => {
    expect(emailSender({})).toBeInstanceOf(ConsoleSender)
    expect(emailSender({ RESEND_API_KEY: 'x' })).toBeInstanceOf(ResendSender)
  })
})
