import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { docPage, docPages } from './docs'
// @ts-expect-error plain ESM script without types
import { render } from '../scripts/build-docs.mjs'

const ERR_CODES = ['invalid_identifier', 'invalid_ttl', 'rate_limited', 'upstream_error', 'signature_expired']

describe('rendered docs', () => {
  it('has a page for every docs/api markdown file', () => {
    const files = readdirSync(new URL('../../../docs/api/', import.meta.url)).filter((f) => f.endsWith('-v1.md'))
    expect(docPages()).toHaveLength(files.length)
    expect(docPage('')?.title).toBe('API reference')
    for (const slug of ['errors', 'examples', 'hashing', 'json-mode', 'format-quality', 'cache-ttl', 'gravatar-differences']) {
      expect(docPage(slug), slug).toBeDefined()
    }
  })

  it('rewrites cross-page .md links to /docs routes', () => {
    for (const p of docPages()) expect(p.html, p.slug).not.toMatch(/href="[^"]*-v1\.md/)
    expect(docPage('')!.html).toContain('href="/docs/errors"')
  })

  it('gives error codes anchors that errors.ts links to', () => {
    const html = docPage('errors')!.html
    for (const c of ERR_CODES) expect(html).toContain(`id="${c}"`)
  })

  it('gives headings unique anchors and lists h2s for the sidebar', () => {
    for (const p of docPages()) {
      const ids = [...p.html.matchAll(/<h[1-3] id="([^"]+)"/g)].map((m) => m[1])
      expect(new Set(ids).size, p.slug).toBe(ids.length)
      expect(p.headings.every((h) => ids.includes(h.id))).toBe(true)
    }
  })

  it('ships curl, JavaScript, and img examples with no-referrer', () => {
    const html = docPage('examples')!.html
    expect(html).toContain('curl')
    expect(html).toContain('fetch(')
    expect(html).toContain('referrerpolicy=&quot;no-referrer&quot;')
  })

  it('wraps tables so they scroll at phone width', () => {
    expect(docPage('errors')!.html).toContain('class="docs-table"')
  })

  it('numbers repeated headings', () => {
    const { html } = render('x', '## A\n\n## A\n')
    expect(html).toContain('id="a"')
    expect(html).toContain('id="a-1"')
  })

  it('keeps the generated module out of runtime file reads', () => {
    for (const f of ['../components/DocsView.tsx', '../app/docs/page.tsx', '../app/docs/[slug]/page.tsx', './docs.ts']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf8')).not.toMatch(/node:fs|readFile/)
    }
  })
})
