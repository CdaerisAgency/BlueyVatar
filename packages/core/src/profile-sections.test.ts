import { describe, expect, it } from 'vitest'
import { applyHiddenSections, HIDDEN_SECTIONS, parseHiddenSections, SECTION_KEYS } from './profile-sections.js'
import { buildJsonExport, buildMarkdown, buildVcard, toExportProfile } from './profile-export.js'

const full = {
  handle: 'alice.test', displayName: 'Alice',
  links: [{ label: 'Site', url: 'https://a.test/' }],
  socialLinks: [{ label: 'Me', url: 'https://social.test/a' }],
  languages: [{ tag: 'en', primary: true }],
  wallets: [{ chain: 'btc', address: 'bc1qaaa', label: null, verified: false }],
  interests: ['chess'],
  gallery: [{ url: '/img/x', caption: null }],
  verifiedAccounts: [{ platform: 'github', uri: 'https://github.com/a', hidden: false }],
}

describe('applyHiddenSections', () => {
  it('returns every key when nothing is hidden', () => {
    expect(applyHiddenSections(full)).toEqual(full)
    expect(applyHiddenSections(full, [])).toEqual(full)
  })
  it('does not change its input', () => {
    const copy = structuredClone(full)
    applyHiddenSections(full, [...HIDDEN_SECTIONS])
    expect(full).toEqual(copy)
  })
  for (const s of HIDDEN_SECTIONS) {
    it(`removes the ${s} keys, not empty arrays`, () => {
      const out = applyHiddenSections(full, [s])
      for (const k of SECTION_KEYS[s]) expect(Object.keys(out)).not.toContain(k)
      expect(out.handle).toBe('alice.test')
    })
  }
  it('reads hiddenSections from the profile and drops that key', () => {
    const out = applyHiddenSections({ ...full, hiddenSections: ['wallets'] })
    expect(out).not.toHaveProperty('wallets')
    expect(out).not.toHaveProperty('hiddenSections')
    expect(out).toHaveProperty('interests')
  })
  it('ignores unknown and malformed values', () => {
    expect(parseHiddenSections(['wallets', 'nope', 3, null, 'wallets'])).toEqual(['wallets'])
    expect(parseHiddenSections('wallets')).toEqual([])
    expect(parseHiddenSections(undefined)).toEqual([])
    expect(applyHiddenSections(full, ['nope', 'constructor', '__proto__'])).toEqual(full)
  })
})

describe('exports with hidden sections', () => {
  const marks: Record<(typeof HIDDEN_SECTIONS)[number], string> = {
    links: 'a.test', languages: 'LANG', wallets: 'bc1qaaa', interests: 'chess', gallery: '', verifiedAccounts: 'github.com',
  }
  for (const s of HIDDEN_SECTIONS) {
    it(`omits ${s} from JSON, Markdown, and vCard`, () => {
      const p = toExportProfile({ profile: full, deliveryOrigin: 'https://img.test', profileBaseUrl: 'https://b.test', hiddenSections: [s] })
      const json = JSON.parse(buildJsonExport(p)) as Record<string, unknown>
      for (const k of SECTION_KEYS[s]) expect(json).not.toHaveProperty(k)
      expect(json).not.toHaveProperty('hiddenSections')
      if (marks[s]) for (const out of [buildJsonExport(p), buildMarkdown(p).replace(/\\/g, ''), buildVcard(p)]) expect(out).not.toContain(marks[s])
    })
  }
  it('also hides sections when an ExportProfile still holds the data', () => {
    const p = { ...toExportProfile({ profile: full, deliveryOrigin: 'https://img.test', profileBaseUrl: 'https://b.test' }), hiddenSections: ['wallets' as const, 'links' as const] }
    expect(buildMarkdown(p)).not.toContain('bc1qaaa')
    expect(buildVcard(p)).not.toContain('bc1qaaa')
    expect(buildVcard(p)).not.toContain('social.test')
  })
  it('keeps everything when the field is absent', () => {
    const p = toExportProfile({ profile: full, deliveryOrigin: 'https://img.test', profileBaseUrl: 'https://b.test' })
    expect(buildVcard(p)).toContain('bc1qaaa')
    expect(JSON.parse(buildJsonExport(p))).toHaveProperty('wallets')
  })
})
