import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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
})
