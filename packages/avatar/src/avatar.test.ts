import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { avatarUrl, emailHash, fromGravatarUrl, profileUrl } from './index.js'
import { Avatar } from './react.js'

const ADA = 'b5fc85e55755f9e0d030a10ab4429b6b2944855f9a0d60077fe832becbc41d72'
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('emailHash (docs/api/hashing-v1.md)', () => {
  it('matches the documented algorithm for fixed vectors', async () => {
    expect(await emailHash('ada@example.com')).toBe(ADA)
    expect(await emailHash('')).toBe(EMPTY)
  })
  it('trims and lowercases before hashing', async () => {
    expect(await emailHash('  Ada@Example.COM \n')).toBe(ADA)
  })
  it('matches node:crypto SHA-256 hex, which packages/core emailHash uses', async () => {
    for (const e of ['a@b.co', 'MiXeD@Case.Org', 'ünï@example.com']) {
      expect(await emailHash(e)).toBe(createHash('sha256').update(e.trim().toLowerCase()).digest('hex'))
    }
    expect(await emailHash('ada@example.com')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('avatarUrl', () => {
  it('builds a hash URL with parameters', () => {
    const u = new URL(avatarUrl({ hash: ADA.toUpperCase(), size: 128, default: 'identicon', rating: 'pg', format: 'webp', quality: 70, forceDefault: true, key: 'pk_x' }))
    expect(u.origin).toBe('https://img.blueyvatar.com')
    expect(u.pathname).toBe('/avatar/' + ADA)
    expect(Object.fromEntries(u.searchParams)).toEqual({ s: '128', d: 'identicon', r: 'pg', fmt: 'webp', q: '70', f: 'y', token: 'pk_x' })
  })
  it('has no query string when no options are set', () => {
    expect(avatarUrl({ hash: ADA })).toBe('https://img.blueyvatar.com/avatar/' + ADA)
  })
  it('routes handles and DIDs to /u/{id}', () => {
    expect(avatarUrl({ handle: '@Alice.Example.com' })).toBe('https://img.blueyvatar.com/u/alice.example.com')
    expect(avatarUrl({ did: 'did:plc:abc123', baseUrl: 'http://localhost:8787/' })).toBe('http://localhost:8787/u/did%3Aplc%3Aabc123')
  })
  it('accepts an MD5 hash', () => {
    const md5 = createHash('md5').update('ada@example.com').digest('hex')
    expect(avatarUrl({ hash: md5 })).toContain('/avatar/' + md5)
  })
  it('rejects bad input', () => {
    expect(() => avatarUrl({})).toThrow(TypeError)
    expect(() => avatarUrl({ hash: ADA, handle: 'a.example.com' })).toThrow(TypeError)
    expect(() => avatarUrl({ hash: 'ada@example.com' })).toThrow(/emailHash/)
    expect(() => avatarUrl({ hash: ADA, size: 0 })).toThrow(TypeError)
    expect(() => avatarUrl({ hash: ADA, size: 4096 })).toThrow(TypeError)
    expect(() => avatarUrl({ hash: ADA, quality: 101 })).toThrow(TypeError)
    expect(() => avatarUrl({ hash: ADA, default: 'http://x.example/a.png' })).toThrow(TypeError)
    expect(() => avatarUrl({ hash: ADA, default: 'color' })).toThrow(TypeError)
    expect(() => avatarUrl({ did: 'alice' })).toThrow(TypeError)
  })
  it('encodes an HTTPS default URL', () => {
    const u = new URL(avatarUrl({ hash: ADA, default: 'https://cdn.example.com/a b.png' }))
    expect(u.searchParams.get('d')).toBe('https://cdn.example.com/a b.png')
  })
})

describe('profileUrl', () => {
  it('builds the JSON endpoint', () => {
    expect(profileUrl({ id: 'alice.example.com', key: 'pk_x' })).toBe('https://img.blueyvatar.com/profile/alice.example.com?token=pk_x')
    expect(profileUrl({ id: ADA })).toBe('https://img.blueyvatar.com/profile/' + ADA)
  })
  it('rejects an email address', () => {
    expect(() => profileUrl({ id: 'ada@example.com' })).toThrow(TypeError)
  })
})

describe('fromGravatarUrl', () => {
  it('maps s, d, r, f', () => {
    const { options, notes } = fromGravatarUrl('https://gravatar.com/avatar/' + ADA + '?s=200&d=mm&r=pg&f=y')
    expect(options).toEqual({ hash: ADA, size: 200, default: 'mp', rating: 'pg', forceDefault: true })
    expect(notes.join(' ')).toMatch(/Ratings differ/)
  })
  it('accepts long names, an extension, and an MD5 hash', () => {
    const md5 = createHash('md5').update('a').digest('hex')
    const { options } = fromGravatarUrl(`https://www.gravatar.com/avatar/${md5}.jpg?size=64&default=retro&forcedefault=y`)
    expect(options).toEqual({ hash: md5, size: 64, default: 'retro', forceDefault: true })
  })
  it('clamps size and notes dropped values', () => {
    const r = fromGravatarUrl('https://gravatar.com/avatar/' + ADA + '?s=5000&d=color&r=zz')
    expect(r.options).toEqual({ hash: ADA, size: 2048 })
    expect(r.notes).toHaveLength(2)
  })
  it('keeps custom default URLs with a tier note', () => {
    const r = fromGravatarUrl('https://gravatar.com/avatar/' + ADA + '?d=' + encodeURIComponent('https://cdn.example.com/a.png'))
    expect(r.options.default).toBe('https://cdn.example.com/a.png')
    expect(r.notes[0]).toMatch(/Pro/)
  })
  it('feeds avatarUrl and carries base options', () => {
    const { options } = fromGravatarUrl('https://gravatar.com/avatar/' + ADA + '?s=96', { baseUrl: 'https://img.example', key: 'pk_x' })
    expect(avatarUrl(options)).toBe('https://img.example/avatar/' + ADA + '?s=96&token=pk_x')
  })
  it('rejects non-avatar URLs', () => {
    expect(() => fromGravatarUrl('https://gravatar.com/ada')).toThrow(TypeError)
  })
})

describe('<Avatar />', () => {
  it('defaults to no-referrer and lazy loading', () => {
    const html = renderToStaticMarkup(createElement(Avatar, { handle: 'alice.example.com', alt: 'Alice', size: 48 }))
    expect(html).toMatch(/<img[^>]*referrerPolicy="no-referrer"/i)
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('width="48"')
    expect(html).toContain('src="https://img.blueyvatar.com/u/alice.example.com?s=48"')
    expect(html).toContain('alt="Alice"')
  })
  it('lets the caller override defaults and pass img props', () => {
    const html = renderToStaticMarkup(createElement(Avatar, { hash: ADA, alt: '', loading: 'eager', className: 'a', referrerPolicy: 'origin' }))
    expect(html).toContain('loading="eager"')
    expect(html).toMatch(/<img[^>]*referrerPolicy="origin"/i)
    expect(html).toContain('class="a"')
  })
})
