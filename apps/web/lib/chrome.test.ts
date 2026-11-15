import { describe, expect, it } from 'vitest'
import { COPY } from './copy'
import config from '../next.config'
import { footerLinksFor, heroTarget, pricingTarget, SESSION_ROUTES } from './chrome'

describe('footer links', () => {
  it('keeps Sign in for visitors and drops it for signed-in people', () => {
    expect(footerLinksFor(COPY.footer.links, false).some((l) => l.href === '/login')).toBe(true)
    const signedIn = footerLinksFor(COPY.footer.links, true)
    expect(signedIn.some((l) => l.href === '/login')).toBe(false)
    expect(signedIn.length).toBe(COPY.footer.links.length - 1)
  })
})

describe('pricing buttons', () => {
  it('send visitors to sign in and signed-in people to the account or checkout', () => {
    expect(pricingTarget('plus', false)).toBe('/login')
    expect(pricingTarget('free', true)).toBe('/account')
    expect(pricingTarget('plus', true)).toBeNull()
  })
})

describe('landing call to action', () => {
  it('goes to sign in for visitors and the account for signed-in people', () => {
    expect(heroTarget(false)).toBe('/login')
    expect(heroTarget(true)).toBe('/account')
  })
})

describe('session pages and caching', () => {
  it('send Cache-Control private, no-store on every session route', async () => {
    const rules = await config.headers!()
    for (const route of SESSION_ROUTES) {
      const rule = rules.find((r) => r.source === route)
      expect(rule?.headers).toContainEqual({ key: 'Cache-Control', value: 'private, no-store' })
    }
  })
  it('leave the landing page, pricing, docs and /img out of that rule', async () => {
    const sources = (await config.headers!()).map((r) => r.source)
    for (const s of ['/', '/pricing', '/docs', '/img/:path*']) expect(sources).not.toContain(s)
  })
})
