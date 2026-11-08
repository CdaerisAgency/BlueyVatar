import { afterEach, describe, expect, it } from 'vitest'
import { cfSaasConfig, mapHostname } from './cf-saas'
import { APEX_MESSAGE, isApexDomain, normalizeHostname, validateCustomHostname } from './domains'
import { TtlCache } from './host-cache'
import { planFor } from './records'

describe('validateCustomHostname', () => {
  it('accepts subdomains and normalizes', () => {
    expect(validateCustomHostname(' Me.Example.com. ')).toEqual({ ok: true, value: 'me.example.com' })
    expect(validateCustomHostname('a.b.example.co.uk')).toEqual({ ok: true, value: 'a.b.example.co.uk' })
  })
  it('rejects apex domains with the handle message, including multi-label suffixes', () => {
    for (const h of ['example.com', 'example.co.uk']) {
      expect(validateCustomHostname(h)).toEqual({ ok: false, error: APEX_MESSAGE })
    }
    expect(APEX_MESSAGE).toContain('account handle')
  })
  it('rejects bad input', () => {
    for (const h of ['', 'localhost', 'https://me.example.com', 'me.example.com/x', 'me.example.com:8080', '1.2.3.4', 'com', 'co.uk', '-a.example.com', 'a_b.example.com', 'me.example.invalidtld']) {
      expect(validateCustomHostname(h).ok, h).toBe(false)
    }
  })
  it('rejects reserved hosts and their subdomains', () => {
    expect(validateCustomHostname('profiles.blueyvatar.com', ['profiles.blueyvatar.com']).ok).toBe(false)
    expect(validateCustomHostname('x.profiles.blueyvatar.com', ['profiles.blueyvatar.com']).ok).toBe(false)
    expect(validateCustomHostname('me.blueyvatar.com', ['profiles.blueyvatar.com']).ok).toBe(true)
  })
  it('detects apex', () => {
    expect(isApexDomain('example.com')).toBe(true)
    expect(isApexDomain('me.example.com')).toBe(false)
    expect(normalizeHostname('A.B.')).toBe('a.b')
  })
})

describe('mapHostname', () => {
  it('is active only when hostname and certificate are both active', () => {
    expect(mapHostname({ id: '1', hostname: 'a.example.com', status: 'active', ssl: { status: 'active' } }).status).toBe('active')
    expect(mapHostname({ status: 'active', ssl: { status: 'pending_validation' } }).status).toBe('pending')
    expect(mapHostname({ status: 'pending', ssl: { status: 'initializing' } }).status).toBe('pending')
  })
  it('flags terminal failures', () => {
    expect(mapHostname({ status: 'blocked' }).status).toBe('failed')
    expect(mapHostname({ status: 'pending', ssl: { status: 'validation_timed_out' } }).status).toBe('failed')
  })
  it('collects TXT records and errors', () => {
    const s = mapHostname({
      id: 'x',
      hostname: 'a.example.com',
      ownership_verification: { name: '_cf-custom-hostname.a.example.com', type: 'txt', value: 'uuid' },
      ssl: { status: 'pending_validation', validation_records: [{ txt_name: '_acme-challenge.a.example.com', txt_value: 'tok' }] },
      verification_errors: ['not found'],
    })
    expect(s.records.map((r) => r.purpose)).toEqual(['hostname', 'certificate'])
    expect(s.errors).toEqual(['not found'])
  })
})

describe('cfSaasConfig and planFor', () => {
  const old = process.env.PLUS_DIDS
  afterEach(() => {
    if (old === undefined) delete process.env.PLUS_DIDS
    else process.env.PLUS_DIDS = old
  })
  it('is null unless both vars are set', () => {
    expect(cfSaasConfig({ CF_SAAS_ZONE_ID: 'z' })).toBeNull()
    expect(cfSaasConfig({ CF_SAAS_ZONE_ID: 'z', CF_SAAS_API_TOKEN: 't' })).toEqual({ zoneId: 'z', token: 't' })
  })
  it('lists Plus DIDs from PLUS_DIDS', () => {
    delete process.env.PLUS_DIDS
    expect(planFor('did:plc:a')).toBe('free')
    process.env.PLUS_DIDS = 'did:plc:b, did:plc:a'
    expect(planFor('did:plc:a')).toBe('plus')
    expect(planFor('did:plc:c')).toBe('free')
  })
})

describe('TtlCache', () => {
  it('expires entries, caches misses, and evicts the oldest', () => {
    let t = 0
    const c = new TtlCache<string | null>(100, 2, () => t)
    c.set('a', 'x')
    c.set('m', null)
    expect(c.get('m')).toEqual({ value: null })
    c.set('b', 'y')
    expect(c.get('a')).toBeUndefined()
    t = 101
    expect(c.get('m')).toBeUndefined()
  })
})
