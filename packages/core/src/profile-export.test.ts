import { describe, expect, it } from 'vitest'
import {
  buildJsonExport, buildMarkdown, buildVcard, exportFileName, mdEscape, toExportProfile, vcardEscapeComponent, vcardEscapeText, vcardFold,
  vcardParamValue, type ExportProfile,
} from './profile-export.js'

const base: ExportProfile = {
  handle: 'alice.test', profileUrl: 'https://blueyvatar.com/p/alice.test', displayName: 'Alice', description: null, avatarUrl: null,
  location: null, jobTitle: null, company: null, pronouns: null, interests: [], languages: [], links: [], socialLinks: [], verifiedAccounts: [], wallets: [],
}

const unfold = (s: string) => s.replace(/\r\n[ \t]/g, '')
const octets = (s: string) => new TextEncoder().encode(s).length

describe('toExportProfile', () => {
  const raw = {
    did: 'did:plc:secret', handle: 'alice.test', displayName: 'Alice', description: 'Hi', email: 'a@b.test', plan: 'plus', emailHash: 'abc',
    avatar: { url: '/img/did%3Aplc%3Ax/bafy/sig/256.png', source: 'service' },
    links: [{ label: 'Site', url: 'https://a.test/' }, { label: 'Bad', url: 'javascript:alert(1)' }, { label: 'Mail', url: 'mailto:a@b.test' }],
    socialLinks: [{ label: 'Me', url: 'https://social.test/@a' }],
    wallets: [{ chain: 'btc', address: 'bc1qaaa', label: null }, { chain: 'eth', address: '0xhidden', label: null, visible: false }],
    verifiedAccounts: [{ platform: 'github', uri: 'https://github.com/a', hidden: false }, { platform: 'x', uri: 'https://x.com/a', hidden: true }],
    languages: [{ tag: 'en', primary: true }, { tag: 'not a tag' }],
    interests: ['chess', '', 4], jobTitle: 'Dev', company: 'Acme',
  }
  const p = toExportProfile({ profile: raw, deliveryOrigin: 'https://img.test', profileBaseUrl: 'https://blueyvatar.com/' })
  it('keeps public fields only', () => {
    const json = buildJsonExport(p)
    for (const secret of ['did:plc', 'a@b.test', 'plus', 'abc', '0xhidden', 'x.com', 'javascript', 'mailto']) expect(json).not.toContain(secret)
    expect(p.avatarUrl).toBe('https://img.test/img/did%3Aplc%3Ax/bafy/sig/256.png')
    expect(p.profileUrl).toBe('https://blueyvatar.com/p/alice.test')
    expect(p.wallets).toEqual([{ chain: 'btc', address: 'bc1qaaa', label: null, verified: false }])
    expect(p.languages).toEqual([{ tag: 'en', primary: true }])
    expect(p.interests).toEqual(['chess'])
    for (const out of [buildMarkdown(p), buildVcard(p)]) for (const secret of ['did:plc', 'a@b.test', '0xhidden', 'x.com']) expect(out).not.toContain(secret)
  })
  it('ignores an avatar path that is not a signed delivery path', () => {
    expect(toExportProfile({ profile: { avatar: { url: 'https://evil.test/a.png' } }, deliveryOrigin: 'https://img.test', profileBaseUrl: 'https://b.test' }).avatarUrl).toBeNull()
  })
  it('survives junk input', () => {
    expect(toExportProfile({ profile: null, deliveryOrigin: 'https://i.test', profileBaseUrl: 'https://b.test' }).handle).toBeNull()
  })
})

describe('vCard escaping', () => {
  it('escapes backslash, comma, and newline in text; keeps the semicolon as the ABNF text rule allows', () => {
    expect(vcardEscapeText('a,b;c\\d\ne\r\nf\rg')).toBe('a\\,b;c\\\\d\\ne\\nf\\ng')
  })
  it('also escapes the semicolon in components', () => {
    expect(vcardEscapeComponent('ABC, Inc.;Div')).toBe('ABC\\, Inc.\\;Div')
  })
  it('drops control characters and bidi overrides', () => {
    expect(vcardEscapeText('a\u0000b\u0007c‮d')).toBe('abcd')
  })
  it('quotes parameter values with comma, semicolon, or colon and removes double quotes', () => {
    expect(vcardParamValue('Work')).toBe('Work')
    expect(vcardParamValue('a,b')).toBe('"a,b"')
    expect(vcardParamValue('say "hi": ok')).toBe('"say \'hi\': ok"')
  })
})

describe('vCard folding', () => {
  it('keeps every physical line within 75 octets and unfolds to the original', () => {
    for (const body of ['x'.repeat(500), 'é'.repeat(200), '😀'.repeat(100), '日本語テキスト,'.repeat(40), 'a'.repeat(73) + '😀' + 'b'.repeat(80)]) {
      const line = `NOTE:${body}`
      const folded = vcardFold(line)
      for (const l of folded.split('\r\n')) expect(octets(l)).toBeLessThanOrEqual(75)
      expect(unfold(folded)).toBe(line)
      for (const l of folded.split('\r\n').slice(1)) expect(l.startsWith(' ')).toBe(true)
    }
  })
  it('never splits a multi-octet character', () => {
    const folded = vcardFold('N:' + '😀'.repeat(60))
    for (const l of folded.split('\r\n')) expect(l).not.toMatch(/�/)
    expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(folded))).toBe(folded)
  })
  it('does not fold a short line', () => {
    expect(vcardFold('FN:Alice')).toBe('FN:Alice')
  })
})

describe('buildVcard', () => {
  const full: ExportProfile = {
    ...base,
    displayName: 'Alice; "Al", O\'Neil 😀', description: 'Line one\nLine two, with comma; and \\ backslash', jobTitle: 'Dev, Lead', company: 'ABC, Inc.; North',
    pronouns: 'she/her', location: 'Berlin, "DE"', interests: ['chess, go', 'art'], avatarUrl: 'https://img.test/img/x/y/z/256.png',
    languages: [{ tag: 'en', primary: true }, { tag: 'pt-BR', primary: false }],
    links: [{ label: 'Site', url: 'https://a.test/?a=1,2;3' }], socialLinks: [{ label: 'M', url: 'https://social.test/@a' }],
    verifiedAccounts: [{ platform: 'GitHub', url: 'https://github.com/a' }],
    wallets: [{ chain: 'ETH, main', address: '0xabc', label: 'Tips', verified: false }],
  }
  const v = buildVcard(full)
  it('uses CRLF and starts and ends correctly', () => {
    expect(v.startsWith('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:')).toBe(true)
    expect(v.endsWith('END:VCARD\r\n')).toBe(true)
    expect(v.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const l of v.split('\r\n')) expect(octets(l)).toBeLessThanOrEqual(75)
  })
  it('emits the expected properties', () => {
    const u = unfold(v)
    expect(u).toContain('FN:Alice; "Al"\\, O\'Neil 😀\r\n')
    expect(u).toContain('TITLE:Dev\\, Lead\r\n')
    expect(u).toContain('ORG:ABC\\, Inc.\\; North\r\n')
    expect(u).toContain('NOTE:Line one\\nLine two\\, with comma; and \\\\ backslash\r\n')
    expect(u).toContain('PRONOUNS:she/her\r\n')
    expect(u).toContain('ADR;LABEL="Berlin, \'DE\'":;;;;;;\r\n')
    expect(u).toContain('CATEGORIES:chess\\, go,art\r\n')
    expect(u).toContain('LANG;PREF=1:en\r\nLANG:pt-BR\r\n')
    expect(u).toContain('PHOTO:https://img.test/img/x/y/z/256.png\r\n')
    expect(u).toContain('URL:https://blueyvatar.com/p/alice.test\r\n')
    expect(u).toContain('URL:https://a.test/?a=1,2;3\r\n')
    expect(u).toContain('SOCIALPROFILE:https://social.test/@a\r\n')
    expect(u).toContain('SOCIALPROFILE;SERVICE-TYPE=GitHub:https://github.com/a\r\n')
    expect(u).toContain('X-BLUEYVATAR-WALLET;X-CHAIN="ETH, main";X-LABEL=Tips;X-VERIFIED=false:0xabc\r\n')
    expect(u).not.toContain('\r\nN:')
  })
  it('cannot be tricked into a new property by a newline in user text', () => {
    const hostile = buildVcard({ ...base, displayName: 'Bob\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Evil', description: 'x\nTEL:555' })
    expect(unfold(hostile).split('\r\n').filter((l) => l.startsWith('TEL') || l.startsWith('BEGIN') || l.startsWith('END'))).toEqual(['BEGIN:VCARD', 'END:VCARD'])
  })
  it('works with only the required properties', () => {
    expect(buildVcard({ ...base, displayName: null, handle: null, profileUrl: null })).toBe('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Unknown\r\nEND:VCARD\r\n')
  })
})

describe('buildMarkdown', () => {
  it('renders sections for a full profile', () => {
    const md = buildMarkdown({
      ...base, description: 'Hello', jobTitle: 'Dev', company: 'Acme', location: 'Rome', pronouns: 'she/her', interests: ['chess'],
      languages: [{ tag: 'en', primary: true }], links: [{ label: 'Site', url: 'https://a.test/' }],
      wallets: [{ chain: 'btc', address: 'bc1q', label: 'Main', verified: false }], avatarUrl: 'https://i.test/a.png',
    })
    expect(md.startsWith('# Alice\n')).toBe(true)
    expect(md).toContain('## Details')
    expect(md).toContain('- Job title: Dev')
    expect(md).toContain('## Languages')
    expect(md).toContain('English \\(en\\) (primary)')
    expect(md).toContain('- [Site](https://a.test/)')
    expect(md).toContain('## Wallets (not verified)')
    expect(md).toContain('- Main, btc: ` bc1q ` (not verified)')
  })
  it('escapes hostile text so it cannot make links, HTML, images, headings, or lists', () => {
    const hostile = '[click](https://evil.test) <script>alert(1)</script> ![x](https://evil.test/a.png) # h\n- item\n1. one\n> quote\n`code` &amp; http://evil.test www.evil.test a@evil.test'
    const md = buildMarkdown({
      ...base, displayName: hostile, description: hostile, jobTitle: hostile, company: hostile, location: hostile, pronouns: hostile,
      interests: [hostile], links: [{ label: hostile, url: 'https://a.test/x)(<y>' }], verifiedAccounts: [{ platform: hostile, url: 'https://g.test/' }],
      wallets: [{ chain: hostile, address: 'ab`cd', label: hostile, verified: false }],
    })
    // The only unescaped link syntax is ours: "](" that follows our own link label or our own fixed text.
    const body = md.replace(/\[Profile page\]\(https:\/\/blueyvatar\.com\/p\/alice\.test\)/, '')
    const unescaped = (re: RegExp) => [...body.matchAll(re)].filter((m) => m.index === 0 || body[m.index! - 1] !== '\\')
    expect(unescaped(/<(?=[a-z/!])/gi)).toEqual([])
    expect(unescaped(/!\[/g)).toEqual([])
    expect(unescaped(/`/g).length).toBe(5) // the wallet code span: two fences of two plus the one backtick inside the address
    // Every link in the output points to one of our two known https URLs.
    const dests = [...body.matchAll(/(?<!\\)\]\(([^)]*)\)/g)].map((m) => m[1])
    expect(dests.sort()).toEqual(['https://a.test/x%29%28%3Cy%3E', 'https://g.test/'].sort())
    // No line starts as a heading, quote, or list unless we wrote it.
    for (const line of body.split('\n')) {
      if (/^(#{1,6} |> )/.test(line)) expect(['# \\[click\\]', '## Details', '## Links', '## Verified accounts', '## Wallets (not verified)'].some((h) => line.startsWith(h) || line.startsWith('# '))).toBe(true)
    }
    expect(body).not.toMatch(/^\s*(?:\d+\.|[-*+]) (?!Pronouns|Job title|Company|Location|Interests|\[|.*\(not verified\))/m)
    expect(md).not.toContain('<script>')
  })
  it('mdEscape escapes the syntax characters', () => {
    expect(mdEscape('*a* _b_ [c](d) <e> #f')).toBe('\\*a\\* \\_b\\_ \\[c\\]\\(d\\) \\<e\\> \\#f')
  })
})

describe('exports misc', () => {
  it('file names are safe', () => {
    expect(exportFileName('alice.test', 'vcf')).toBe('alice.test.vcf')
    expect(exportFileName('../a"b\r\nc', 'md')).toBe('_a_b__c.md')
    expect(exportFileName(null, 'json')).toBe('profile.json')
  })
})
