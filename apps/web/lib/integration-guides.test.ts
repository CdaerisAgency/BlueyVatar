import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAvatarParams } from '@blueyvatar/core'

const NEW_GUIDES = ['gitlab', 'gitea', 'forgejo', 'redmine'] as const
const ALL_GUIDES = [...NEW_GUIDES, 'discourse'] as const
const read = (name: string) => readFileSync(fileURLToPath(new URL(`../../../docs/integrations/${name}-v1.md`, import.meta.url)), 'utf8')
const HASH = 'a'.repeat(64)

describe('integration guides', () => {
  it('every guide URL example parses', () => {
    for (const name of ALL_GUIDES) {
      const urls = read(name).match(/https:\/\/img\.blueyvatar\.com\/avatar\/[^\s`'")]*/g) ?? []
      if (name !== 'discourse') expect(urls.length).toBeGreaterThan(0)
      for (const raw of urls) {
        const url = new URL(raw.replace(/%\{hash\}/g, HASH).replace(/%\{size\}/g, '80'))
        expect(() => parseAvatarParams(url.searchParams, { tier: 'free', defaultUrlAllowlist: [] }), `${name}: ${raw}`).not.toThrow()
      }
    }
  })

  it('each new guide has the five sections', () => {
    for (const name of NEW_GUIDES) {
      const headings = [...read(name).matchAll(/^## (.+)$/gm)].map((m) => m[1])
      for (const h of ['What you change', 'Steps', 'Check it worked', 'Without a BlueyVatar avatar', 'Limits']) {
        expect(headings, `${name} needs "${h}"`).toContain(h)
      }
    }
  })

  it('guides use no em-dashes and the Limits section has no digits', () => {
    for (const name of ALL_GUIDES) {
      const text = read(name)
      expect(text).not.toContain('\u2014')
      const limits = /^## Limits\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? ''
      expect(limits.length, name + ' has a Limits section').toBeGreaterThan(0)
      expect(limits, name).not.toMatch(/\d/)
    }
  })
})
