import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_NAV, allItems, currentItemHref, groupIdFor, nextIndex, openGroupIds, parseStoredOpen } from './account-nav'

const accountDir = join(__dirname, '..', 'app', 'account')

describe('group membership', () => {
  it('matches the approved grouping', () => {
    expect(ACCOUNT_NAV.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Profile', ['Profile', 'Avatars', 'Visibility']],
      ['Identity', ['Verified accounts', 'Verify', 'Custom profile domain']],
      ['Developers', ['API keys and license']],
      ['Billing', ['Plan and billing']],
      ['Settings', ['Notifications', 'Sign-out options', 'Danger zone']],
    ])
  })
  it('lists each route once and every route has a page', () => {
    const hrefs = allItems().map((i) => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    for (const h of hrefs) expect(() => readFileSync(join(accountDir, h.replace('/account', ''), 'page.tsx'), 'utf8')).not.toThrow()
  })
  it('finds the group for a page', () => {
    expect(groupIdFor('/account/domain')).toBe('identity')
    expect(groupIdFor('/account/settings/danger')).toBe('settings')
    expect(groupIdFor('/account')).toBeNull()
  })
})

describe('current page detection', () => {
  it('matches exact routes and picks the longest for nested ones', () => {
    expect(currentItemHref('/account/settings')).toBe('/account/settings')
    expect(currentItemHref('/account/settings/danger')).toBe('/account/settings/danger')
    expect(currentItemHref('/account/avatars/import')).toBe('/account/avatars')
    expect(currentItemHref('/account/keys/')).toBe('/account/keys')
  })
  it('returns null for pages outside the menu', () => {
    expect(currentItemHref('/account')).toBeNull()
    expect(currentItemHref('/account/orgs')).toBeNull()
    expect(currentItemHref('/account/avatarsX')).toBeNull()
  })
})

describe('open groups', () => {
  it('opens the group with the current page by default', () => {
    expect(openGroupIds('/account/claims', null)).toEqual(['identity'])
    expect(openGroupIds('/account', null)).toEqual([])
  })
  it('keeps saved groups and always adds the current one', () => {
    expect(openGroupIds('/account/keys', ['profile', 'bogus'])).toEqual(['profile', 'developers'])
  })
  it('reads saved state defensively', () => {
    expect(parseStoredOpen(null)).toBeNull()
    expect(parseStoredOpen('{bad')).toBeNull()
    expect(parseStoredOpen('[1]')).toBeNull()
    expect(parseStoredOpen('["profile"]')).toEqual(['profile'])
  })
})

describe('arrow keys', () => {
  it('moves and wraps', () => {
    expect(nextIndex(0, 3, 'ArrowDown')).toBe(1)
    expect(nextIndex(2, 3, 'ArrowDown')).toBe(0)
    expect(nextIndex(0, 3, 'ArrowUp')).toBe(2)
    expect(nextIndex(1, 3, 'Home')).toBe(0)
    expect(nextIndex(1, 3, 'End')).toBe(2)
    expect(nextIndex(1, 3, 'a')).toBe(1)
    expect(nextIndex(0, 0, 'ArrowDown')).toBe(-1)
  })
})

describe('label equals heading', () => {
  for (const item of allItems()) {
    it(`${item.href} heading is "${item.label}"`, () => {
      const src = readFileSync(join(accountDir, item.href.replace('/account', ''), 'page.tsx'), 'utf8')
      const headings = [...src.matchAll(/<h1>([^<{]*?)(?::\s*)?(?:\{[^}]*\})?<\/h1>/g)].map((m) => m[1]!.trim())
      expect(headings.length).toBeGreaterThan(0)
      for (const h of headings) expect(h).toBe(item.label)
    })
  }
})
