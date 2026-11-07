import { describe, expect, it } from 'vitest'
import {
  emailHash, isSha256Hex, parseIdentifier, ratingFromLabels, ratingAllowed,
  parseAvatarParams, ParamError, pickCandidate, imagePath, snapSize, ladderPaths, IMAGE_SIZE_LADDER, readBlobRef, selfLabelValues,
  activeAdapters, DEFAULT_ADAPTERS, type Candidate,
} from './index.js'

const opts = { tier: 'free' as const, defaultUrlAllowlist: ['example.com'] }

describe('hash and identifiers', () => {
  it('normalizes email before hashing', () => {
    expect(emailHash('  MyEmail@Example.com ')).toBe(emailHash('myemail@example.com'))
    expect(isSha256Hex(emailHash('a@b.c'))).toBe(true)
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
    const p = parseAvatarParams(new URLSearchParams('fmt=webp&q=70&ttl=7d&d=https://example.com/x.png'), { ...opts, tier: 'pro' })
    expect(p).toMatchObject({ format: 'webp', quality: 70, ttlSeconds: 7 * 86400, default: { kind: 'url' } })
  })
  it('rejects bad input', () => {
    expect(() => parseAvatarParams(new URLSearchParams('r=nc17'), opts)).toThrow(ParamError)
    expect(() => parseAvatarParams(new URLSearchParams('d=http://example.com/x.png'), opts)).toThrow(ParamError)
    expect(() => parseAvatarParams(new URLSearchParams('d=https://evil.test/x.png'), opts)).toThrow(ParamError)
    expect(() => parseAvatarParams(new URLSearchParams('ttl=30m'), { ...opts, tier: 'pro' })).toThrow(ParamError)
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
    expect(imagePath('did:plc:x', 'bafy', 80, 'png')).toBe('/img/did%3Aplc%3Ax/bafy/80.png')
    expect(imagePath('did:plc:x', 'bafy', 80, 'webp', 60)).toBe('/img/did%3Aplc%3Ax/bafy/80-q60.webp')
  })
  it('builds one canonical path per variant', () => {
    // Off-ladder sizes snap up, off-set qualities snap to the nearest allowed one.
    expect(imagePath('did:plc:x', 'bafy', 100, 'png')).toBe('/img/did%3Aplc%3Ax/bafy/128.png')
    expect(imagePath('did:plc:x', 'bafy', 2048, 'png')).toBe('/img/did%3Aplc%3Ax/bafy/2048.png')
    expect(imagePath('did:plc:x', 'bafy', 3000, 'png')).toBe('/img/did%3Aplc%3Ax/bafy/2048.png')
    expect(imagePath('did:plc:x', 'bafy', 80, 'webp', 70)).toBe('/img/did%3Aplc%3Ax/bafy/80-q60.webp')
    expect(imagePath('did:plc:x', 'bafy', 80, 'webp', 100)).toBe('/img/did%3Aplc%3Ax/bafy/80.webp')
    // PNG ignores quality, and the default quality has no suffix.
    expect(imagePath('did:plc:x', 'bafy', 80, 'png', 60)).toBe('/img/did%3Aplc%3Ax/bafy/80.png')
    expect(imagePath('did:plc:x', 'bafy', 80, 'jpeg', 85)).toBe('/img/did%3Aplc%3Ax/bafy/80.jpeg')
  })
  it('snaps sizes up to the ladder and keeps every tier cap on a ladder step', () => {
    expect(snapSize(1)).toBe(16)
    expect(snapSize(81)).toBe(96)
    for (const cap of [512, 1024, 2048]) expect(snapSize(cap)).toBe(cap)
  })
  it('lists every canonical path for purge', () => {
    const paths = ladderPaths('did:plc:x', 'bafy')
    expect(paths).toHaveLength(IMAGE_SIZE_LADDER.length * 5)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain('/img/did%3Aplc%3Ax/bafy/512.png')
    expect(paths).toContain('/img/did%3Aplc%3Ax/bafy/512-q60.jpeg')
    expect(paths).toContain('/img/did%3Aplc%3Ax/bafy/512.webp')
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
    expect(activeAdapters(DEFAULT_ADAPTERS).map((a) => a.id)).toEqual(['bluesky'])
  })
})
