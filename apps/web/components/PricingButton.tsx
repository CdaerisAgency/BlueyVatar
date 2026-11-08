'use client'

import { startCheckout } from '../app/account/billing/actions'
import { buttonClass, ButtonLink } from './Button'
import { useViewer } from './useViewer'

/**
 * Plan button. Signed out: sign in. Signed in: Free goes to the account, paid plans start checkout directly
 * (the same action the Billing page uses, which shows its own error when billing is not available).
 */
export default function PricingButton({ tier, highlighted, children }: { tier: string; highlighted: boolean; children: string }) {
  const v = useViewer()
  const variant = highlighted ? 'primary' : 'secondary'
  if (!v.signedIn) return <ButtonLink href="/login" variant={variant} className="mt-auto">{children}</ButtonLink>
  if (tier === 'free') return <ButtonLink href="/account" variant={variant} className="mt-auto">{children}</ButtonLink>
  return (
    <form action={startCheckout} className="mt-auto flex">
      <input type="hidden" name="tier" value={tier} />
      <button type="submit" className={buttonClass(variant, 'md', 'w-full')}>{children}</button>
    </form>
  )
}
