import { readdirSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PageHeader } from '../components/Page'
import { ACCOUNT_HOME, ACCOUNT_NAV, allItems, currentItemHref, groupIdFor, nextIndex, openGroupIds, parseStoredOpen } from './account-nav'

const accountDir = join(__dirname, '..', 'app', 'account')

describe('group membership', () => {
  it('matches the approved grouping', () => {
    expect(ACCOUNT_NAV.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Profile', ['Profile', 'Profile views', 'Avatars', 'Visibility']],
      ['Identity', ['Organizations', 'Linked accounts', 'Verify', 'Custom profile domain']],
      ['Developers', ['API keys']],
      ['Billing', ['Plan and billing']],
      ['Settings', ['Notifications', 'Sign-out options', 'Appeal', 'Danger zone']],
    ])
  })
  it('lists each route once and every route has a page', () => {
    const hrefs = allItems().map((i) => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    for (const h of hrefs) expect(() => readFileSync(join(accountDir, h.replace('/account', ''), 'page.tsx'), 'utf8')).not.toThrow()
  })
  it('puts Overview above the groups, outside them', () => {
    expect(ACCOUNT_HOME).toEqual({ href: '/account', label: 'Overview' })
    expect(ACCOUNT_NAV.flatMap((g) => g.items).some((i) => i.href === '/account')).toBe(false)
  })
  it('finds the group for a page', () => {
    expect(groupIdFor('/account/domain')).toBe('identity')
    expect(groupIdFor('/account/settings/danger')).toBe('settings')
    expect(groupIdFor('/account')).toBeNull()
    expect(groupIdFor('/account/orgs')).toBe('identity')
    expect(groupIdFor('/account/stats')).toBe('profile')
    expect(groupIdFor('/account/appeal')).toBe('settings')
  })
})

describe('current page detection', () => {
  it('matches exact routes and picks the longest for nested ones', () => {
    expect(currentItemHref('/account/settings')).toBe('/account/settings')
    expect(currentItemHref('/account/settings/danger')).toBe('/account/settings/danger')
    expect(currentItemHref('/account/avatars/import')).toBe('/account/avatars')
    expect(currentItemHref('/account/keys/')).toBe('/account/keys')
  })
  it('highlights Overview only on /account itself', () => {
    expect(currentItemHref('/account')).toBe('/account')
    expect(currentItemHref('/account/')).toBe('/account')
    expect(currentItemHref('/account/nope')).toBeNull()
  })
  it('keeps nested pages on their parent item', () => {
    expect(currentItemHref('/account/orgs')).toBe('/account/orgs')
    expect(currentItemHref('/account/orgs/abc-123')).toBe('/account/orgs')
    expect(currentItemHref('/account/stats')).toBe('/account/stats')
    expect(currentItemHref('/account/appeal')).toBe('/account/appeal')
  })
  it('returns null for pages outside the menu', () => {
    expect(currentItemHref('/account/avatarsX')).toBeNull()
  })
})

describe('open groups', () => {
  it('opens the group with the current page by default', () => {
    expect(openGroupIds('/account/claims', null)).toEqual(['identity'])
    expect(openGroupIds('/account', null)).toEqual([])
    expect(openGroupIds('/account/orgs/abc-123', null)).toEqual(['identity'])
    expect(openGroupIds('/account/appeal', null)).toEqual(['settings'])
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

/** The visible title of a page: its PageHeader title, either a plain string or a template that starts with the label ("Plan and billing: {org}"). */
function pageTitles(src: string): string[] {
  return [...src.matchAll(/<PageHeader title=(?:"([^"]*)"|\{`([^`$]*?)(?::\s*)?(?:\$\{[^}]*\})?`\})/g)].map((m) => (m[1] ?? m[2])!.trim())
}

describe('label equals heading', () => {
  for (const item of allItems()) {
    it(`${item.href} heading is "${item.label}"`, () => {
      const src = readFileSync(join(accountDir, item.href.replace('/account', ''), 'page.tsx'), 'utf8')
      const headings = pageTitles(src)
      expect(headings.length).toBeGreaterThan(0)
      for (const h of headings) expect(h).toBe(item.label)
    })
  }
})

describe('one page header', () => {
  const pages = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(join(dir, e.name)) : e.name === 'page.tsx' ? [join(dir, e.name)] : []))
  for (const file of pages(accountDir)) {
    it(`${file.slice(accountDir.length)} uses PageHeader and no bare h1`, () => {
      const src = readFileSync(file, 'utf8')
      expect(src).not.toMatch(/<h1[\s>]/)
      if (src.includes('<PageMain')) expect(src).toContain('<PageHeader') // a page that only redirects has no header
    })
  }
  it('PageHeader renders exactly one h1, with the intro and actions when given', () => {
    const html = renderToStaticMarkup(createElement(PageHeader, { title: 'API keys', intro: 'Keys.', actions: createElement('a', null, 'Go') }))
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('<h1>API keys</h1>')
    expect(html).toContain('Keys.')
    expect(renderToStaticMarkup(createElement(PageHeader, { title: 'X' }))).toBe('<header><h1>X</h1></header>')
  })
})

describe('page standard v2', () => {
  const pages = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(join(dir, e.name)) : e.name === 'page.tsx' ? [join(dir, e.name)] : []))
  const withHeader = pages(accountDir).filter((f) => readFileSync(f, 'utf8').includes('<PageMain'))
  for (const file of withHeader) {
    const src = readFileSync(file, 'utf8')
    it(`${file.slice(accountDir.length)} gives every PageHeader an intro and uses Section, not bare h2`, () => {
      const headers = src.match(/<PageHeader\b[\s\S]*?\/>/g) ?? []
      expect(headers.length).toBeGreaterThan(0)
      for (const h of headers) expect(h).toMatch(/\sintro=/)
      expect(src).not.toMatch(/<h2[\s>]/)
      expect(src).not.toMatch(/<h3[\s>]/)
    })
  }
  it('sub-pages link back to their parent', () => {
    for (const f of ['avatars/import', 'orgs/[id]', 'settings/danger']) expect(readFileSync(join(accountDir, f, 'page.tsx'), 'utf8')).toContain('<BackLink')
  })
})
