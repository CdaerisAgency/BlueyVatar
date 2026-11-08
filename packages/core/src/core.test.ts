import { describe, expect, it } from 'vitest'
import {
  emailHash, emailMd5, isMd5Hex, isSha256Hex, parseIdentifier, ratingFromLabels, ratingAllowed,
  parseAvatarParams, ParamError, pickCandidate, imagePath, imageFile, imageSig, verifyImageSig, scopeExpired, snapSize, ladderPaths, IMAGE_SIZE_LADDER, readBlobRef, selfLabelValues,
  activeAdapters, DEFAULT_ADAPTERS, sanitizeProfileLinks, resolveProfileLinks, type Candidate,
} from './index.js'

const opts = { tier: 'free' as const, defaultUrlAllowlist: ['example.com'] }

describe('hash and identifiers', () => {
  it('normalizes email before hashing', () => {
    expect(emailHash('  MyEmail@Example.com ')).toBe(emailHash('myemail@example.com'))
    expect(isSha256Hex(emailHash('a@b.c'))).toBe(true)
  })
  it('computes the MD5 from the same normalized email', () => {
    // Gravatar's documented MD5 example input, hashed after trim and lowercase.
    expect(emailMd5('  MyEmail@Example.com ')).toBe(emailMd5('myemail@example.com'))
    expect(emailMd5(' MyEmailAddress@example.com ')).toBe('0bc83cb571cd1c50ba6f3e8a78ef1346')
    expect(isMd5Hex(emailMd5('a@b.c'))).toBe(true)
    expect(isMd5Hex(emailHash('a@b.c'))).toBe(false)
    expect(isSha256Hex(emailMd5('a@b.c'))).toBe(false)
    expect(isMd5Hex('A'.repeat(32))).toBe(false)
  })
  it('classifies identifiers', () => {
    expect(parseIdentifier('did:plc:ewvi7nxzyoun6zhxrhs64oiz')?.kind).toBe('did')
    expect(parseIdentifier('@Alice.bsky.social')).toEqual({ kind: 'handle', value: 'alice.bsky.social' })
    expect(parseIdentifier('a'.repeat(64))?.kind).toBe('hash')
    expect(parseIdentifier('not a handle')).toBeNull()
  })
})

describe('ratings', () => {
  it('maps self-labels to ratings', () => {
    expect(ratingFromLabels([])).toBe('g')
    expect(ratingFromLabels(['nudity'])).toBe('pg')
    expect(ratingFromLabels(['graphic-media'])).toBe('r')
    expect(ratingFromLabels(['nudity', 'porn'])).toBe('x')
  })
  it('compares ratings', () => {
    expect(ratingAllowed('pg', 'g')).toBe(false)
    expect(ratingAllowed('g', 'x')).toBe(true)
  })
})

describe('params', () => {
  it('applies defaults', () => {
    const p = parseAvatarParams(new URLSearchParams(), opts)
    expect(p).toMatchObject({ size: 80, rating: 'g', format: 'png', quality: 85, json: false, forceDefault: false })
  })
  it('clamps size to the tier cap and reports it', () => {
    const p = parseAvatarParams(new URLSearchParams('s=4000'), opts)
    expect(p.size).toBe(512)
    expect(p.adjusted).toContain('s')
    expect(parseAvatarParams(new URLSearchParams('s=4000'), { ...opts, tier: 'business' }).size).toBe(2048)
  })
  it('ignores gated parameters on free', () => {
    const p = parseAvatarParams(new URLSearchParams('fmt=webp&ttl=7d'), opts)
    expect(p.format).toBe('png')
    expect(p.adjusted).toEqual(['fmt', 'ttl'])
  })
  it('honors gated parameters on pro', () => {
    const p = parseAvatarParams(new URLSearchParams('fmt=webp&q=70&ttl=7d&d=https://example.com/x.png'), { ...opts, tier: 'plus' })
    expect(p).toMatchObject({ format: 'webp', quality: 70, ttlSeconds: 7 * 86400, default: { kind: 'url' } })
  })
  describe('fmt and q (F13)', () => {
    const parse = (qs: string, tier: 'free' | 'plus' | 'business' | 'enterprise') => parseAvatarParams(new URLSearchParams(qs), { ...opts, tier })
    const paid = ['plus', 'business', 'enterprise'] as const

    it('accepts png, jpeg, and webp on every paid tier with no adjustment', () => {
      for (const tier of paid) {
        for (const fmt of ['png', 'jpeg', 'webp'] as const) {
          const p = parse(`fmt=${fmt}`, tier)
          expect(p.format).toBe(fmt)
          expect(p.adjusted).toEqual([])
        }
      }
    })
    it('gives free PNG only and reports every ignored fmt and q', () => {
      for (const fmt of ['jpeg', 'webp']) {
        const p = parse(`fmt=${fmt}&q=70`, 'free')
        expect(p).toMatchObject({ format: 'png', quality: 85 })
        expect(p.adjusted).toEqual(['fmt', 'q'])
      }
      expect(parse('fmt=png', 'free').adjusted).toEqual([])
      expect(parse('q=70', 'free').adjusted).toEqual(['q'])
    })
    it('accepts q from 1 to 100 on paid tiers and defaults to 85', () => {
      for (const tier of paid) {
        expect(parse('', tier).quality).toBe(85)
        expect(parse('q=1', tier).quality).toBe(1)
        expect(parse('q=100', tier).quality).toBe(100)
        expect(parse('q=70', tier).adjusted).toEqual([])
      }
    })
    it('rejects bad q on every tier', () => {
      for (const tier of ['free', ...paid] as const) {
        for (const q of ['0', '101', 'abc', '-5', '7.5', '']) {
          expect(() => parse(`q=${q}`, tier), `${tier} q=${q}`).toThrow(/q must be 1 to 100/)
        }
      }
    })
    it('rejects unknown and wrongly cased fmt on every tier', () => {
      for (const tier of ['free', ...paid] as const) {
        for (const fmt of ['gif', 'avif', 'jpg', 'PNG', 'WEBP', 'Jpeg', '']) {
          expect(() => parse(`fmt=${fmt}`, tier), `${tier} fmt=${fmt}`).toThrow(ParamError)
        }
      }
    })
  })
  it('rejects bad input', () => {
    expect(() => parseAvatarParams(new URLSearchParams('r=nc17'), opts)).toThrow(ParamError)
    expect(() => parseAvatarParams(new URLSearchParams('d=http://example.com/x.png'), opts)).toThrow(ParamError)
    expect(() => parseAvatarParams(new URLSearchParams('d=https://evil.test/x.png'), opts)).toThrow(ParamError)
    expect(() => parseAvatarParams(new URLSearchParams('ttl=30m'), { ...opts, tier: 'plus' })).toThrow(ParamError)
  })
})

describe('default style blank', () => {
  it('parses d=blank as a style', () => {
    const p = parseAvatarParams(new URLSearchParams('d=blank'), opts)
    expect(p.default).toEqual({ kind: 'style', style: 'blank' })
  })
})

describe('resolution', () => {
  const c = (rating: Candidate['rating'], source: Candidate['source']): Candidate => ({
    source, did: 'did:plc:x', blob: { cid: 'bafy', mimeType: 'image/png' }, rating,
  })
  it('takes the first candidate that passes the rating filter', () => {
    const r = pickCandidate([c('r', 'blueyvatar-default'), c('g', 'adapter:bluesky')], 'g', false)
    expect(r).toEqual({ kind: 'image', candidate: c('g', 'adapter:bluesky') })
  })
  it('falls back to default', () => {
    expect(pickCandidate([c('x', 'blueyvatar')], 'g', false)).toEqual({ kind: 'default' })
    expect(pickCandidate([c('g', 'blueyvatar')], 'g', true)).toEqual({ kind: 'default' })
  })
  it('builds an immutable path with a file extension', () => {
    const sig = imageSig('s3cret', 'did:plc:x', 'bafy', '80.png')
    expect(imagePath('s3cret', 'did:plc:x', 'bafy', 80, 'png')).toBe(`/img/did%3Aplc%3Ax/bafy/${sig}/80.png`)
    expect(imagePath('s3cret', 'did:plc:x', 'bafy', 80, 'webp', 70)).toMatch(/^\/img\/did%3Aplc%3Ax\/bafy\/[A-Za-z0-9_-]{22}\/80-q60\.webp$/)
    expect(verifyImageSig('s3cret', 'did:plc:x', 'bafy', '80.png', sig)).toBe('')
    expect(verifyImageSig('other', 'did:plc:x', 'bafy', '80.png', sig)).toBeNull()
    const scoped = imageSig('s3cret', 'did:plc:x', 'bafy', '80.png', 'k:L1:20000')
    expect(verifyImageSig('s3cret', 'did:plc:x', 'bafy', '80.png', scoped)).toBe('k:L1:20000')
    expect(scopeExpired('k:L1:20000', 20001 * 86_400_000)).toBe(false)
    expect(scopeExpired('k:L1:20000', 20002 * 86_400_000)).toBe(true)
  })
  it('builds one canonical file name per variant', () => {
    // Off-ladder sizes snap up, off-set qualities snap to the nearest allowed one.
    expect(imageFile(100, 'png')).toBe('128.png')
    expect(imageFile(2048, 'png')).toBe('2048.png')
    expect(imageFile(3000, 'png')).toBe('2048.png')
    expect(imageFile(80, 'webp', 70)).toBe('80-q60.webp')
    expect(imageFile(80, 'webp', 100)).toBe('80.webp')
    // PNG ignores quality, and the default quality has no suffix.
    expect(imageFile(80, 'png', 60)).toBe('80.png')
    expect(imageFile(80, 'jpeg', 85)).toBe('80.jpeg')
    expect(imagePath('s3cret', 'did:plc:x', 'bafy', 100, 'webp', 70)).toMatch(/\/128-q60\.webp$/)
  })
  it('snaps sizes up to the ladder and keeps every tier cap on a ladder step', () => {
    expect(snapSize(1)).toBe(16)
    expect(snapSize(81)).toBe(96)
    for (const cap of [512, 1024, 2048]) expect(snapSize(cap)).toBe(cap)
  })
  it('lists every canonical signed path for purge', () => {
    const paths = ladderPaths('s3cret', 'did:plc:x', 'bafy')
    expect(paths).toHaveLength(IMAGE_SIZE_LADDER.length * 5)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain(imagePath('s3cret', 'did:plc:x', 'bafy', 512, 'png'))
    expect(paths).toContain(imagePath('s3cret', 'did:plc:x', 'bafy', 512, 'jpeg', 60))
    expect(paths).toContain(imagePath('s3cret', 'did:plc:x', 'bafy', 512, 'webp'))
    expect(paths.some((x) => x.includes('-q85') || x.endsWith('-q60.png'))).toBe(false)
  })
})

describe('adapters', () => {
  it('reads blob refs and labels', () => {
    expect(readBlobRef({ $type: 'blob', ref: { $link: 'bafyabc' }, mimeType: 'image/jpeg', size: 10 }))
      .toEqual({ cid: 'bafyabc', mimeType: 'image/jpeg', size: 10 })
    expect(readBlobRef({ cid: 'bafylegacy', mimeType: 'image/png' })?.cid).toBe('bafylegacy')
    expect(selfLabelValues({ values: [{ val: 'porn' }, { val: 1 }] })).toEqual(['porn'])
  })
  it('orders enabled adapters by priority', () => {
    expect(activeAdapters(DEFAULT_ADAPTERS).map((a) => a.id)).toEqual(['bluesky', 'tangled', 'tangled-legacy'])
  })
  it('limits Tangled avatars to the lexicon size and leaves Bluesky unlimited here', () => {
    const limits = Object.fromEntries(DEFAULT_ADAPTERS.map((a) => [a.id, a.maxAvatarBytes]))
    expect(limits).toEqual({ bluesky: undefined, tangled: 1_000_000, 'tangled-legacy': 1_000_000 })
  })
  it('marks the legacy Tangled adapter as a fallback for the new one', () => {
    const legacy = DEFAULT_ADAPTERS.find((a) => a.id === 'tangled-legacy')
    expect(legacy?.fallbackFor).toBe('tangled')
    expect(legacy?.collection).toBe('sh.tangled.actor.profile')
    expect(DEFAULT_ADAPTERS.find((a) => a.id === 'tangled')?.collection).toBe('org.tangled.actor.profile')
  })
})

describe('sanitizeProfileLinks', () => {
  it('keeps https links, falls back to the host, and drops everything else', () => {
    expect(sanitizeProfileLinks([
      { label: 'Site', url: 'https://example.com/a' },
      { url: 'https://blog.example.org' },
      { label: 'Plain', url: 'http://example.com' },
      { label: 'Script', url: 'javascript:alert(1)' },
      { label: 'Creds', url: 'https://u:p@example.com' },
      { label: 'Bad', url: 'not a url' },
      { label: 'Num', url: 5 },
      null,
    ])).toEqual([
      { label: 'Site', url: 'https://example.com/a' },
      { label: 'blog.example.org', url: 'https://blog.example.org/' },
    ])
  })
  it('caps at 10 and tolerates a missing field', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ label: `L${i}`, url: `https://e${i}.test` }))
    expect(sanitizeProfileLinks(many)).toHaveLength(10)
    expect(sanitizeProfileLinks(undefined)).toEqual([])
    expect(sanitizeProfileLinks('x')).toEqual([])
  })
})

describe('resolveProfileLinks', () => {
  const did = 'did:plc:a'
  const uri = (k: string) => `at://${did}/app.bsky.actor.link/${k}`
  const recs = [
    { rkey: 'a', cid: 'ca', url: 'https://a.test/', title: 'A' },
    { rkey: 'b', cid: 'cb', url: 'https://b.test/', title: null },
    { rkey: 'c', cid: 'cc', url: 'http://c.test/', title: 'C' },
  ]
  it('resolves refs in profile order and drops stale, foreign, missing, and non-https ones', () => {
    const refs = [
      { uri: uri('b'), cid: 'cb' },
      { uri: uri('a'), cid: 'OLD' },
      { uri: 'at://did:plc:other/app.bsky.actor.link/a', cid: 'ca' },
      { uri: uri('zzz'), cid: 'cz' },
      { uri: uri('c'), cid: 'cc' },
      { uri: uri('a'), cid: 'ca' },
      'junk',
    ]
    expect(resolveProfileLinks(did, refs, recs)).toEqual([
      { label: 'b.test', url: 'https://b.test/' },
      { label: 'A', url: 'https://a.test/' },
    ])
  })
  it('ignores a missing links field and caps at 10 refs', () => {
    expect(resolveProfileLinks(did, undefined, recs)).toEqual([])
    const many = Array.from({ length: 12 }, (_, i) => ({ rkey: `k${i}`, cid: `c${i}`, url: `https://e${i}.test`, title: null }))
    expect(resolveProfileLinks(did, many.map((r) => ({ uri: uri(r.rkey), cid: r.cid })), many)).toHaveLength(10)
  })
})
