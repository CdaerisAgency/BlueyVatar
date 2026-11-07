import { PricingSection } from '../../components/PricingSection'
import { pageMetadata, pricingDescription } from '../../lib/site'

export const metadata = pageMetadata('/pricing', 'Pricing | blueyvatar', pricingDescription())

export default function PricingPage() {
  return (
    <main id="main" tabIndex={-1} className="focus:outline-none">
      <PricingSection headingAs="h1" />
    </main>
  )
}
