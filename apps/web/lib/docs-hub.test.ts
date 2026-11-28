import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DocsView } from '../components/DocsView'
import { GUIDE_HUB } from './copy/public'
import { docPage } from './docs'

const script = readFileSync(fileURLToPath(new URL('../scripts/build-docs.mjs', import.meta.url)), 'utf8')
const integrations = [...(/const INTEGRATIONS = \[([^\]]+)\]/.exec(script)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])

describe('guide hub', () => {
  it('hub lists every guide', () => {
    expect(integrations.length).toBeGreaterThan(0)
    expect(GUIDE_HUB.map((g) => g.slug)).toEqual(integrations)
  })

  it('every hub entry links to an existing doc page', () => {
    for (const g of GUIDE_HUB) expect(docPage('integrations-' + g.slug), g.slug).toBeDefined()
  })

  it('every entry is under 5 minutes', () => {
    for (const g of GUIDE_HUB) {
      expect(g.minutes).toBeGreaterThanOrEqual(2)
      expect(g.minutes).toBeLessThanOrEqual(5)
    }
  })

  it('every entry has a name and a one-line change without em-dashes', () => {
    for (const g of GUIDE_HUB) {
      expect(g.name.length).toBeGreaterThan(0)
      expect(g.change).not.toMatch(/—|\n/)
    }
  })

  it('on the /docs index the hub heading comes after the h1 and before the API page list', () => {
    const out = renderToStaticMarkup(createElement(DocsView, { page: docPage('')!, hub: true }))
    const h1 = out.indexOf('<h1')
    const hub = out.indexOf('id="guide-hub"')
    expect(h1).toBeGreaterThan(-1)
    expect(hub).toBeGreaterThan(h1)
    expect(out.match(/<h1/g)).toHaveLength(1)
    const apiPages = out.indexOf('<table', out.indexOf('</section>'))
    expect(apiPages).toBeGreaterThan(hub)
  })
  it('other doc pages render no hub', () => {
    expect(renderToStaticMarkup(createElement(DocsView, { page: docPage('examples')! }))).not.toContain('guide-hub')
  })

  it('the /docs index has exactly one list of guide links, the hub', () => {
    expect(docPage('')!.html).not.toContain('/docs/integrations-')
    const out = renderToStaticMarkup(createElement(DocsView, { page: docPage('')!, hub: true }))
    const main = out.slice(out.indexOf('<main'))
    expect(main.split("href=\"/docs/integrations-").length - 1).toBe(GUIDE_HUB.length)
    expect(main.match(/aria-labelledby="guide-hub"/g)).toHaveLength(1)
  })
})
