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
