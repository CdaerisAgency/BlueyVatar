import { describe, expect, it } from 'vitest'
import { LabelView, labelSubjectDid } from './labels.js'
import { NoopScanner, PhotoDnaScanner, decideScan, scannerFromEnv } from './scanner.js'

const bytes = new Uint8Array([1, 2, 3])
const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
const scanner = (f: typeof fetch) => new PhotoDnaScanner({ endpoint: 'https://photodna.test/match', key: 'k', fetch: f })

describe('PhotoDnaScanner', () => {
  it('sends the key and base64 body and reads a clear result', async () => {
    let seen: { headers?: Record<string, string>; body?: string } = {}
    const f = (async (_u: unknown, init: RequestInit) => { seen = { headers: init.headers as Record<string, string>, body: init.body as string }; return new Response(JSON.stringify({ IsMatch: false, Status: { Code: 3000 } })) }) as unknown as typeof fetch
    expect(await scanner(f).scan(bytes, 'image/png')).toEqual({ status: 'clear' })
    expect(seen.headers?.['Ocp-Apim-Subscription-Key']).toBe('k')
    expect(JSON.parse(seen.body!).Value).toBe('AQID')
  })
  it('reports a match with flags', async () => {
    const r = await scanner(reply({ IsMatch: true, Status: { Code: 3000 }, MatchDetails: { MatchFlags: [{ Source: 'x' }] } })).scan(bytes, 'image/png')
    expect(r).toMatchObject({ status: 'match', service: 'photodna' })
  })
  it('turns http errors, bad bodies, bad status, and network failures into errors', async () => {
    expect((await scanner(reply({}, 500)).scan(bytes, 'image/png')).status).toBe('error')
    expect((await scanner(reply({ nope: 1 })).scan(bytes, 'image/png')).status).toBe('error')
    expect((await scanner(reply({ IsMatch: false, Status: { Code: 3201 } })).scan(bytes, 'image/png')).status).toBe('error')
    const boom = (async () => { throw new Error('secret detail') }) as unknown as typeof fetch
    expect(await scanner(boom).scan(bytes, 'image/png')).toEqual({ status: 'error', service: 'photodna', reason: 'Error' })
  })
})

describe('scannerFromEnv and decideScan', () => {
  it('is off unless both variables are set', () => {
    expect(scannerFromEnv({})).toBeInstanceOf(NoopScanner)
    expect(scannerFromEnv({ PHOTODNA_ENDPOINT: 'https://x' })).toBeInstanceOf(NoopScanner)
    expect(scannerFromEnv({ PHOTODNA_ENDPOINT: 'https://x', PHOTODNA_KEY: 'k' })).toBeInstanceOf(PhotoDnaScanner)
  })
  it('blocks matches, allows outages by default, blocks them when SCAN_FAIL_CLOSED is set', () => {
    const err = { status: 'error', service: 'photodna', reason: 'x' } as const
    expect(decideScan({ status: 'match', service: 'photodna', flags: [] }, {}).allow).toBe(false)
    expect(decideScan(err, {})).toEqual({ allow: true, outcome: 'outage_allowed' })
    expect(decideScan(err, { SCAN_FAIL_CLOSED: '1' }).allow).toBe(false)
    expect(decideScan({ status: 'clear' }, {})).toEqual({ allow: true, outcome: 'clear' })
  })
})

describe('LabelView', () => {
  const did = 'did:plc:a'
  it('parses subjects', () => {
    expect(labelSubjectDid(did)).toBe(did)
    expect(labelSubjectDid('at://did:plc:a/app.bsky.feed.post/1')).toBe(did)
    expect(labelSubjectDid('https://x')).toBeNull()
  })
  it('raises ratings only', () => {
    const v = new LabelView(did, [{ subject: did, val: 'nudity' }])
    expect(v.effectiveRating('g')).toBe('pg')
    expect(v.effectiveRating('r')).toBe('r')
  })
})
