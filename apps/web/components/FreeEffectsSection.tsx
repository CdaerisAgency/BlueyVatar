import { Section } from './Page'
import { myOffers } from '../lib/effects/my-offers'

const day = (d: Date) => new Date(d.getTime() - 1).toISOString().slice(0, 10)

/** Free effects an admin has opened for this account right now (issue #308). Renders nothing when there are none. */
export async function FreeEffectsSection({ did }: { did: string }) {
  const offers = await myOffers(did)
  if (offers.length === 0) return null
  return (
    <Section title="Free for a limited time" intro="These effects are free for you until the last day shown. Avatars you make with them keep working afterward.">
      <ul>
        {offers.map((o) => <li key={o.id}><strong>{o.name}</strong> ({o.effect}), free until {day(o.endsAt)} (UTC).</li>)}
      </ul>
    </Section>
  )
}
