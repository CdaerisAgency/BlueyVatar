import { describe, expect, it } from 'vitest'
import * as core from '@blueyvatar/core'
import * as limits from './profile-limits'
import { validateProfileAll, type ProfileInput } from './records'
import { readProfileForm } from './profile-form'
import { pageAllLinks, pageLanguages, pageWallets, type PublicProfile } from './profile-page'

const base: ProfileInput = { jobTitle: '', company: '', location: '', pronouns: '', pronunciation: '', timezone: '', interests: '' }
const pub = { did: 'did:plc:a', handle: 'a.test', displayName: null, description: null, avatar: null, jobTitle: null, company: null, location: null, pronouns: null } as PublicProfile

describe('limits stay in step with core', () => {
  it('matches every shared constant', () => {
    for (const k of ['MAX_LANGUAGES', 'MAX_LANGUAGE_TAG_LENGTH', 'MAX_SOCIAL_LINKS', 'MAX_SOCIAL_LABEL_GRAPHEMES', 'MAX_WALLETS', 'MAX_WALLET_CHAIN_GRAPHEMES', 'MAX_WALLET_ADDRESS_GRAPHEMES', 'MAX_WALLET_LABEL_GRAPHEMES'] as const) {
      expect(limits[k], k).toBe(core[k])
    }
  })
})

describe('validate rows', () => {
  it('saves clean rows and drops blank ones', () => {
    const r = validateProfileAll({
      ...base,
      languages: [{ tag: 'pt-br', primary: true }, { tag: '', primary: false }, { tag: 'en', primary: true }],
      socialLinks: [{ label: ' Blog ', url: 'https://blog.example/x' }, { label: '', url: '' }],
      wallets: [{ chain: 'Bitcoin', address: 'abc123', label: '', visible: false }],
    })
    expect(r).toEqual({
      ok: true,
      value: {
        languages: [{ tag: 'pt-BR', primary: true }, { tag: 'en' }],
        socialLinks: [{ label: 'Blog', url: 'https://blog.example/x' }],
        wallets: [{ chain: 'Bitcoin', address: 'abc123', visible: false }],
      },
    })
  })
  it('reports row errors by original row index', () => {
    const r = validateProfileAll({
      ...base,
      languages: [{ tag: '', primary: false }, { tag: 'en_US', primary: false }],
      socialLinks: [{ label: '', url: 'http://x.example' }, { label: '', url: 'https://u:p@x.example' }, { label: 'x'.repeat(51), url: 'https://ok.example' }],
      wallets: [{ chain: '', address: 'has space', label: '', visible: true }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['languages.1.tag', 'socialLinks.0.url', 'socialLinks.1.url', 'socialLinks.2.label', 'wallets.0.address', 'wallets.0.chain'])
  })
  it('rejects too many rows', () => {
    const r = validateProfileAll({ ...base, languages: Array.from({ length: 11 }, (_, i) => ({ tag: `x-a${i}`, primary: false })) })
    expect(r.ok).toBe(false)
  })
})

describe('form reading', () => {
  it('reads indexed rows, the primary radio, and the wallet checkbox', () => {
    const f = new FormData()
    f.set('languages.0.tag', 'en')
    f.set('languages.1.tag', 'fr')
    f.set('languagesPrimary', '1')
    f.set('socialLinks.0.label', 'A')
    f.set('socialLinks.0.url', 'https://a.example/')
    f.set('wallets.0.chain', 'Bitcoin')
    f.set('wallets.0.address', 'abc')
    f.set('wallets.0.label', '')
    f.set('wallets.0.visible', 'on')
    f.set('wallets.1.chain', 'Eth')
    f.set('wallets.1.address', 'def')
    const v = readProfileForm(f)
    expect(v.languages).toEqual([{ tag: 'en', primary: false }, { tag: 'fr', primary: true }])
    expect(v.socialLinks).toEqual([{ label: 'A', url: 'https://a.example/' }])
    expect(v.wallets.map((w) => w.visible)).toEqual([true, false])
  })
})

describe('page helpers', () => {
  it('merges links without duplicates and flags self-declared ones', () => {
    const l = pageAllLinks({ ...pub, links: [{ label: 'A', url: 'https://a.example/' }], socialLinks: [{ label: 'A2', url: 'https://a.example/' }, { label: 'B', url: 'https://b.example/' }, { label: 'bad', url: 'javascript:1' }] })
    expect(l).toEqual([{ label: 'A', url: 'https://a.example/', selfDeclared: false }, { label: 'B', url: 'https://b.example/', selfDeclared: true }])
  })
  it('names languages and rechecks wallets', () => {
    expect(pageLanguages({ ...pub, languages: [{ tag: 'es', primary: true }] })).toEqual([{ tag: 'es', primary: true, name: 'Spanish' }])
    expect(pageWallets({ ...pub, wallets: [{ chain: 'B', address: 'ok' }, { chain: 'B', address: 'no good' }] })).toEqual([{ chain: 'B', address: 'ok', label: null, verified: false }])
  })
})
