import Link from 'next/link'
import { PricingSection } from '../../components/PricingSection'
import { pageMetadata, pricingDescription } from '../../lib/site'

export const metadata = pageMetadata('/pricing', 'Pricing | blueyvatar', pricingDescription())

export default function PricingPage() {
  return (
    <main>
      <PricingSection headingAs="h1" />
      <p className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-5">
        Coming from another avatar service? See the <Link href="/gravatar-alternative">Gravatar comparison</Link> or the <Link href="/migrate-from-gravatar">migration guide</Link>.
      </p>
    </main>
  )
}
