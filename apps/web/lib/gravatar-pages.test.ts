import { describe, expect, it } from 'vitest'
import { exampleMigration, faqJsonLd, FAQS, GRAVATAR_DOCS } from './gravatar-pages'
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
    expect(pageMetadata('/x', 'A Gravatar alternative on atproto | BlueyVatar', 'd').title.length).toBeLessThan(60)
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
})
