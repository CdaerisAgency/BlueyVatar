import { describe, expect, it } from 'vitest'
import { normalizeLanguageTag, profileExtras, sanitizeLanguages, sanitizeVisibleWallets } from './profile-extras'

describe('languages', () => {
  it('accepts well-formed BCP 47 tags and canonicalizes case', () => {
    expect(normalizeLanguageTag('pt-br')).toBe('pt-BR')
    expect(normalizeLanguageTag('zh-Hant')).toBe('zh-Hant')
    for (const bad of ['', 'en_US', 'en US', 'x'.repeat(40), 7, 'a'] ) expect(normalizeLanguageTag(bad)).toBeNull()
  })
  it('keeps order, drops duplicates, allows one primary, caps at 10', () => {
    const out = sanitizeLanguages([{ tag: 'en', primary: true }, { tag: 'fr', primary: true }, { tag: 'EN' }, ...Array.from({ length: 20 }, () => ({ tag: 'de' }))])
    expect(out).toEqual([{ tag: 'en', primary: true }, { tag: 'fr', primary: false }, { tag: 'de', primary: false }])
    expect(sanitizeLanguages('x')).toEqual([])
  })
})

describe('wallets', () => {
  it('hides everything unless visible is exactly true', () => {
    const out = sanitizeVisibleWallets([
      { chain: 'Bitcoin', address: 'abc', visible: true },
      { chain: 'Bitcoin', address: 'def' },
      { chain: 'Bitcoin', address: 'ghi', visible: 'true' },
    ])
    expect(out).toEqual([{ chain: 'Bitcoin', address: 'abc', label: null, verified: false }])
  })
  it('rejects whitespace, control characters, and over-long values', () => {
    const w = (address: string, chain = 'X') => [{ chain, address, visible: true }]
    expect(sanitizeVisibleWallets(w('a b'))).toEqual([])
    expect(sanitizeVisibleWallets(w('a\u0000b'))).toEqual([])
    expect(sanitizeVisibleWallets(w('a'.repeat(129)))).toEqual([])
    expect(sanitizeVisibleWallets(w('a'.repeat(128)))).toHaveLength(1)
    expect(sanitizeVisibleWallets(w('abc', 'bad\nchain'))).toEqual([])
  })
})

describe('profileExtras', () => {
  it('returns empty lists for a missing record', () => {
    expect(profileExtras(null)).toEqual({ languages: [], socialLinks: [], wallets: [] })
  })
  it('keeps https social links only, in order', () => {
    expect(profileExtras({ socialLinks: [{ url: 'https://b.example/' }, { url: 'javascript:1' }, { url: 'https://a.example/', label: 'A' }] }).socialLinks.map((l) => l.url)).toEqual(['https://b.example/', 'https://a.example/'])
  })
})
