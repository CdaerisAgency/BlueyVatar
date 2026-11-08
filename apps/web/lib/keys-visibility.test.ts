import { describe, expect, it } from 'vitest'
import { alertState, checkKeyLimit, displayPrefix, generateKey, hashKey, historyPeriods, parseDomainList, validateDomain } from './keys'
import { parseVisibilityForm } from './visibility'

describe('keys', () => {
  it('generates prefixed base64url keys with 32 bytes', () => {
    const sk = generateKey('secret')
    const pk = generateKey('publishable')
    expect(sk).toMatch(/^sk_[A-Za-z0-9_-]{43}$/)
    expect(pk).toMatch(/^pk_[A-Za-z0-9_-]{43}$/)
    expect(generateKey('secret')).not.toBe(sk)
  })
  it('hashes as sha256 hex and keeps a short prefix', () => {
    expect(hashKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(displayPrefix('pk_abcdefghijklmnop')).toBe('pk_abcdef')
  })
  it('enforces Free rules: one publishable key, no secret keys', () => {
    expect(checkKeyLimit('free', 'publishable', []).ok).toBe(true)
    expect(checkKeyLimit('free', 'secret', []).ok).toBe(false)
    expect(checkKeyLimit('free', 'publishable', [{ hash: 'a', kind: 'publishable' }]).ok).toBe(false)
    expect(checkKeyLimit('free', 'publishable', [{ hash: 'a', kind: 'publishable' }], 'a').ok).toBe(true)
  })
  it('enforces maxKeys and allows unlimited Enterprise', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ hash: String(i), kind: 'secret' as const }))
    expect(checkKeyLimit('plus', 'secret', five).ok).toBe(false)
    expect(checkKeyLimit('plus', 'secret', five, '2').ok).toBe(true)
    expect(checkKeyLimit('plus', 'secret', five.slice(0, 4)).ok).toBe(true)
    expect(checkKeyLimit('enterprise', 'secret', Array.from({ length: 500 }, (_, i) => ({ hash: String(i), kind: 'secret' as const }))).ok).toBe(true)
  })
  it('validates domains', () => {
    for (const ok of ['localhost', 'App.Example.com', '*.example.com', 'a-b.co.uk']) expect(validateDomain(ok).ok).toBe(true)
    expect(validateDomain('App.Example.com')).toEqual({ ok: true, value: 'app.example.com' })
    for (const bad of ['', 'example', 'https://example.com', 'example.com/path', 'example.com:8080', '*.com', '*example.com', 'a.*.com', '-a.com', 'a_b.com', '127.0.0.1', 'foo.*', 'a b.com'])
      expect(validateDomain(bad).ok, bad).toBe(false)
  })
  it('parses and dedupes lists', () => {
    expect(parseDomainList('a.com, A.com\n*.b.com localhost')).toEqual({ ok: true, domains: ['a.com', '*.b.com', 'localhost'] })
    expect(parseDomainList('a.com nope').ok).toBe(false)
    expect(parseDomainList('')).toEqual({ ok: true, domains: [] })
  })
  it('lists history periods per tier', () => {
    const now = new Date('2026-02-15T00:00:00Z')
    expect(historyPeriods('free', now)).toEqual([])
    expect(historyPeriods('plus', now)).toEqual(['2026-02-01', '2026-01-01'])
    expect(historyPeriods('pro', now)).toEqual(historyPeriods('plus', now))
    const b = historyPeriods('business', now)
    expect(b).toHaveLength(12)
    expect(b[2]).toBe('2025-12-01')
  })
  it('computes alert state', () => {
    expect(alertState('plus', 39_999)).toBe('ok')
    expect(alertState('plus', 40_000)).toBe('warn80')
    expect(alertState('plus', 50_000)).toBe('over100')
    expect(alertState('free', 5)).toBe('n/a')
  })
})

describe('visibility', () => {
  const base = { keyedOnly: false, domainAllowlistOn: false, domains: '', hiddenProfile: false, emailLookupOptOut: false }
  it('is public by default', () => {
    expect(parseVisibilityForm(base)).toEqual({ ok: true, rules: { keyedOnly: false, domainAllowlist: [], hiddenProfile: false, emailLookupOptOut: false } })
  })
  it('ignores domains when the allowlist is off', () => {
    expect(parseVisibilityForm({ ...base, domains: 'bad host' })).toMatchObject({ ok: true, rules: { domainAllowlist: [] } })
  })
  it('requires valid, non-empty domains when on', () => {
    expect(parseVisibilityForm({ ...base, domainAllowlistOn: true }).ok).toBe(false)
    expect(parseVisibilityForm({ ...base, domainAllowlistOn: true, domains: 'x y!' }).ok).toBe(false)
    expect(parseVisibilityForm({ ...base, domainAllowlistOn: true, domains: 'a.com\n*.b.com', hiddenProfile: true })).toMatchObject({
      ok: true,
      rules: { domainAllowlist: ['a.com', '*.b.com'], hiddenProfile: true },
    })
  })
})
