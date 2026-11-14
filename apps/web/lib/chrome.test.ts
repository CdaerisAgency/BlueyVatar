import { describe, expect, it } from 'vitest'
import { COPY } from './copy'
import { footerLinksFor, pricingTarget } from './chrome'

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
