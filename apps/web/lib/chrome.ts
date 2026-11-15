/** Pure helpers for the session-aware header and footer, kept free of React so they are easy to test. */

/** Footer links for this visitor. The "Sign in" link is dropped once someone is signed in. */
export function footerLinksFor<L extends { href: string }>(links: readonly L[], signedIn: boolean): L[] {
  return links.filter((l) => !(signedIn && l.href === '/login'))
}

/** Where a pricing plan button goes for this visitor, or null when a paid plan starts checkout directly. */
export function pricingTarget(tier: string, signedIn: boolean): string | null {
  if (!signedIn) return '/login'
  return tier === 'free' ? '/account' : null
}

/** Where the landing page call to action goes for this visitor. */
export function heroTarget(signedIn: boolean): string {
  return signedIn ? '/account' : '/login'
}

/** Routes whose HTML depends on the session cookie. They are never stored in a shared cache. */
export const SESSION_ROUTES = ['/login', '/account/:path*', '/report', '/integrations', '/p/:handle*'] as const
