import Link from 'next/link'
import { Button } from './Button'
import { currentDid } from '../lib/auth'
import { dismissOfferBanner } from '../lib/effects/offer-actions'
import { myOffers } from '../lib/effects/my-offers'

/** A dismissible notice on account pages while a free effect offer with notify turned on is live for this account (issue #308). */
export async function OfferBanner() {
  const did = await currentDid()
  if (!did) return null
  const shown = (await myOffers(did)).filter((o) => o.notify && !o.dismissed)
  if (shown.length === 0) return null
  return (
    <div className="mt-4 flex flex-col gap-2">
      {shown.map((o) => (
        <div key={o.id} role="status" className="flex flex-wrap items-center gap-3">
          <span>{o.name} is free for you until {new Date(o.endsAt.getTime() - 1).toISOString().slice(0, 10)} (UTC). <Link href="/account/effects">See effects</Link></span>
          <form action={dismissOfferBanner}>
            <input type="hidden" name="offer" value={o.id} />
            <Button type="submit">Dismiss</Button>
          </form>
        </div>
      ))}
    </div>
  )
}
