import type { PaidPlan } from '@blueyvatar/core'
import { Section } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { planEnabled } from '../../../lib/billing/config'
import type { getPendingChange } from '../../../lib/billing/stripe'
import { PRICING, formatPrice } from '../../../lib/pricing'
import { startCheckout } from './actions'

/** The plan list: what each plan costs, which is current, and the subscribe or switch link. */
export function PlanList({ subs, plan, enterprise, held, pending }: {
  subs: Array<{ tier: string }>
  plan: string
  enterprise: boolean
  /** Tier names the person currently holds. */
  held: Set<string>
  pending: Awaited<ReturnType<typeof getPendingChange>>
}) {
  const canSwitchTo = (id: PaidPlan) => planEnabled(id) && !enterprise
  return (
      <Section title="Plans">
      <ul>
        {PRICING.map((p) => {
          const id = p.id
          const isCurrent = id === 'free' ? subs.length === 0 && !enterprise && plan !== 'plus' : held.has(id) || (id === 'plus' && plan === 'plus' && subs.length === 0)
          return (
            <li key={id}>
              <strong>{p.name}</strong>: {p.amount === 0 ? '$0' : `${formatPrice(p.amount)} per ${p.per === 'mo' ? 'month' : p.per}`}
              {isCurrent && ' (current)'}
              {id !== 'free' && !isCurrent && canSwitchTo(id) && subs.length === 0 && (
                <form action={startCheckout} style={{ display: 'inline', marginLeft: 12 }}>
                  <input type="hidden" name="tier" value={id} />
                  <Button type="submit" variant="primary">Subscribe to {p.name}</Button>
                </form>
              )}
              {id !== 'free' && !isCurrent && canSwitchTo(id) && subs.length > 0 && !pending && (
                <a href={`/account/billing?change=${id}`} style={{ marginLeft: 12 }}>
                  Switch to {p.name}
                </a>
              )}
            </li>
          )
        })}
      </ul>
      {subs.length > 0 && <p>To go back to Free, cancel your subscription below. You keep your paid plan until the end of the period you paid for.</p>}
      <p>Prices exclude tax. Stripe Tax adds any sales tax or VAT at checkout based on your billing address.</p>
      </Section>
  )
}
