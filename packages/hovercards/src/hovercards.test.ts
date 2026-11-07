import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transform } from 'esbuild'
import { buildCard, cardColors, cleanId, profileEndpoint } from './model.js'

const API = 'https://api.example'
const WEB = 'https://blueyvatar.com'

describe('hovercard model', () => {
  it('builds a card from the profile JSON', () => {
    const c = buildCard({ handle: 'a.example.com', displayName: 'Alice', pronouns: 'she/her', jobTitle: 'Dev', company: 'Acme', location: 'Paris', avatar: { url: '/img/did%3Aplc%3Aa/bafy/256.png' } }, API, WEB)
    expect(c).toEqual({ name: 'Alice', lines: ['she/her', 'Dev, Acme', 'Paris'], avatarUrl: `${API}/img/did%3Aplc%3Aa/bafy/256.png`, profileUrl: `${WEB}/p/a.example.com`, accounts: [], colors: null })
  })
  it('omits hidden verified accounts', () => {
    const c = buildCard({ handle: 'a.example.com', verifiedAccounts: [{ service: 'github', label: 'gh/a' }, { service: 'tiktok', hidden: true }, { service: 'threads' }] }, API, WEB)
    expect(c.accounts).toEqual(['gh/a', 'threads'])
  })
  it('reads the platform field of delivery profile JSON', () => {
    const c = buildCard({ handle: 'a.example.com', verifiedAccounts: [{ platform: 'github', uri: 'https://github.com/a', hidden: false }, { platform: 'x', uri: 'https://x.com/a', hidden: true }] }, API, WEB)
    expect(c.accounts).toEqual(['github'])
  })
  it('never passes through attacker-controlled urls', () => {
    const c = buildCard({ handle: 'x"><script>', avatar: { url: 'javascript:alert(1)' } }, API, WEB)
    expect(c.avatarUrl).toBeNull()
    expect(c.profileUrl).toBeNull()
    expect(buildCard({ avatar: { url: '/img/../../etc' } }, API, WEB).avatarUrl).toBeNull()
  })
  it('keeps markup as plain text and tolerates missing fields', () => {
    expect(buildCard({ displayName: '<b>x</b>' }, API, WEB).name).toBe('<b>x</b>')
    expect(buildCard({}, API, WEB).name).toBe('Profile')
  })
  it('validates identifiers and encodes the token', () => {
    expect(cleanId(' a.example.com ')).toBe('a.example.com')
    expect(cleanId('did:plc:abc')).toBe('did:plc:abc')
    expect(cleanId('a b')).toBeNull()
    expect(cleanId('')).toBeNull()
    expect(profileEndpoint(API, 'a.example.com', 'pk_a&b')).toBe(`${API}/profile/a.example.com?token=pk_a%26b`)
  })
})

describe('hovercard background color', () => {
  it('passes a #rrggbb color through with a readable text color', () => {
    expect(cardColors('#1F4E9B')).toEqual({ background: '#1f4e9b', text: '#ffffff' })
    expect(cardColors('#fff1c9')).toEqual({ background: '#fff1c9', text: '#1a1a1a' })
    expect(buildCard({ handle: 'a.example.com', backgroundColor: '#000000' }, API, WEB).colors).toEqual({ background: '#000000', text: '#ffffff' })
  })
  it('uses the default palette when unset, malformed, or when no text color reaches 4.5 to 1', () => {
    expect(buildCard({ handle: 'a.example.com', backgroundColor: null }, API, WEB).colors).toBeNull()
    for (const bad of ['red', '#fff', 'red;position:fixed', '#12345g', 5, undefined]) expect(cardColors(bad), String(bad)).toBeNull()
    expect(cardColors('#777777')).toBeNull()
  })
  it('agrees with the core helper on a sweep of colors', async () => {
    const { profileColors } = await import('../../core/src/color.js')
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
          expect(cardColors(hex), hex).toEqual(profileColors(hex))
        }
      }
    }
  })
})

describe('embed source', () => {
  const src = readFileSync(new URL('hovercards.ts', import.meta.url), 'utf8')
  it('never writes HTML and sets no cookies', () => {
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|document\.cookie/)
    expect(src).toContain("credentials: 'omit'")
    expect(src).toContain("referrerPolicy: 'no-referrer'")
  })
  it('stays small when minified', async () => {
    const out = await transform(src.replace(/^import .*$/m, ''), { loader: 'ts', minify: true, target: 'es2020' })
    expect(out.code.length).toBeLessThan(5000)
  })
})
