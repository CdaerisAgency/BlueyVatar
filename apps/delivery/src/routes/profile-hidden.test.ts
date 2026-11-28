import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { DID, setup } from '../test/harness.js'

/** Hidden sections never reach the profile JSON or any of the three exports (issue #291). */
const SECTIONS = ['links', 'languages', 'wallets', 'interests', 'gallery', 'verifiedAccounts'] as const
type Section = (typeof SECTIONS)[number]

/** A marker per section that would show in the output if the section leaked. */
const MARK: Record<Section, string[]> = {
  links: ['social-link.example'],
  languages: ['pt-BR'],
  wallets: ['bc1qmarkerwallet'],
  interests: ['markerinterest'],
  gallery: ['bafygal'],
  verifiedAccounts: ['github.com/markeracct'],
}
const KEYS: Record<Section, string[]> = {
  links: ['links', 'socialLinks'], languages: ['languages'], wallets: ['wallets'], interests: ['interests'], gallery: ['gallery'], verifiedAccounts: ['verifiedAccounts'],
}

function build(hidden: unknown) {
  const { deps, index } = setup()
  const base = deps.resolver.getRecord
  deps.resolver = {
    ...deps.resolver,
    galleryItems: async () => [{ cid: 'bafygalmarker', rating: 'g' as const, caption: null }],
    getRecord: async (i, collection, rkey) => {
      if (collection === 'com.blueyvatar.profile') {
        return {
          languages: [{ tag: 'pt-BR', primary: true }],
          socialLinks: [{ label: 'Social', url: 'https://social-link.example/me' }],
          wallets: [{ chain: 'Bitcoin', address: 'bc1qmarkerwallet', visible: true }],
          interests: ['markerinterest'],
          ...(hidden === undefined ? {} : { hiddenSections: hidden }),
        }
      }
      if (collection === 'app.bsky.actor.profile') {
        return { displayName: 'Alice' }
      }
      return base(i, collection, rkey)
    },
  }
  deps.plusDids = DID
  index.accounts.set(DID, [{ platform: 'github', uri: 'https://github.com/markeracct', verifiedAt: '2026-01-01T00:00:00.000Z', hidden: false }])
  return createApp(deps)
}

const get = async (app: ReturnType<typeof build>, suffix: string) => (await app.request(`/profile/alice.test${suffix}`)).text()
const FORMATS = ['', '.json', '.md', '.vcf']

describe('hidden sections', () => {
  it('shows every section in the JSON when hiddenSections is absent', async () => {
    const body = JSON.parse(await get(build(undefined), ''))
    for (const s of SECTIONS) for (const k of KEYS[s]) expect(body).toHaveProperty(k)
    expect(body.wallets).toHaveLength(1)
    expect(body.gallery).toHaveLength(1)
    expect(body.verifiedAccounts).toHaveLength(1)
  })

  it('shows the exports when hiddenSections is absent', async () => {
    const app = build(undefined)
    const md = (await get(app, '.md')).replace(/\\/g, '')
    const vcf = await get(app, '.vcf')
    for (const m of ['social-link.example', 'bc1qmarkerwallet', 'markerinterest', 'github.com/markeracct']) {
      expect(md).toContain(m)
      expect(vcf).toContain(m)
    }
    expect(vcf).toContain('LANG')
    expect(md).toContain('## Languages')
  })

  for (const section of SECTIONS) {
    it(`leaves ${section} out of the JSON, Markdown, and vCard when hidden`, async () => {
      const app = build([section])
      const body = JSON.parse(await get(app, ''))
      for (const k of KEYS[section]) expect(body).not.toHaveProperty(k)
      expect(body).not.toHaveProperty('hiddenSections')
      for (const other of SECTIONS.filter((s) => s !== section)) {
        if (section === 'links' && other === 'links') continue
        expect(body, other).toHaveProperty(KEYS[other][0]!)
      }
      for (const f of FORMATS) {
        const out = (await get(app, f)).replace(/\\/g, '')
        for (const m of MARK[section]) expect(out, `${section} in ${f || 'json'}`).not.toContain(m)
        if (f === '.json') for (const k of KEYS[section]) expect(JSON.parse(out), k).not.toHaveProperty(k)
      }
      if (section === 'languages') {
        expect(await get(app, '.md')).not.toContain('## Languages')
        expect(await get(app, '.vcf')).not.toContain('LANG')
      }
    })
  }

  it('hides several sections at once and ignores unknown values', async () => {
    const app = build(['wallets', 'interests', 'future-section', 7, null, 'wallets'])
    const body = JSON.parse(await get(app, ''))
    expect(body).not.toHaveProperty('wallets')
    expect(body).not.toHaveProperty('interests')
    expect(body).toHaveProperty('languages')
    expect(body).toHaveProperty('links')
  })

  it('treats a non-array hiddenSections value as unset', async () => {
    expect(JSON.parse(await get(build('wallets'), ''))).toHaveProperty('wallets')
  })
})
