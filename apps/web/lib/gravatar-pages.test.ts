import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@blueyvatar/core/settings'
import { exampleMigration, faqJsonLd, faqsFor, FAQS, GRAVATAR_DOCS, sizeCapsText } from './gravatar-pages'
import { jsonLdString } from './seo'
import { pageMetadata, ROBOTS_ALLOW, STATIC_PAGES } from './site'

describe('gravatar pages', () => {
  it('lists both pages in the sitemap and robots allow list', () => {
    for (const p of ['/gravatar-alternative', '/migrate-from-gravatar']) {
      expect(STATIC_PAGES).toContain(p)
      expect(ROBOTS_ALLOW).toContain(p)
    }
  })
  it('keeps titles under 60 characters', () => {
    expect(`${pageMetadata('/x', 'A Gravatar alternative on atproto', 'd').title} | BlueyVatar`.length).toBeLessThan(60)
    expect('Migrate from Gravatar to BlueyVatar'.length).toBeLessThan(60)
  })
  it('converts the example URL with the shared helper', () => {
    const m = exampleMigration()
    expect(m.url).toContain('/avatar/')
    expect(m.url).toContain('s=200')
  })
  it('builds escaped FAQPage JSON-LD', () => {
    const ld = faqJsonLd() as { '@type': string; mainEntity: unknown[] }
    expect(ld['@type']).toBe('FAQPage')
    expect(ld.mainEntity).toHaveLength(FAQS.length)
    expect(jsonLdString(faqJsonLd([{ q: '</script>', a: 'a' }]))).not.toContain('<')
  })
  it('cites Gravatar docs over https', () => {
    for (const u of Object.values(GRAVATAR_DOCS)) expect(u).toMatch(/^https:\/\/docs\.gravatar\.com\//)
  })
  it('uses live sizes in the comparison copy', () => {
    const s = structuredClone(DEFAULT_SETTINGS)
    s.maxSize = { free: 256, plus: 800, business: 1600 }
    expect(sizeCapsText(s)).toBe('Free 256, Plus 800, Business 1600, Enterprise 2048')
    const q = faqsFor(s).find((f) => f.q === 'Are there size limits?')!
    expect(q.a).toContain('Free is capped at 256 and Plus at 800')
    expect(q.a).toContain('1 to 1600 pixels on Business')
    expect(FAQS).toEqual(faqsFor(DEFAULT_SETTINGS))
    expect(sizeCapsText(DEFAULT_SETTINGS)).toBe('Free 512, Plus 1024, Business 2048, Enterprise 2048')
  })
})
