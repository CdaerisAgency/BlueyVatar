import { PricingSection } from '../../components/PricingSection'
import { pageMetadata, pricingDescription } from '../../lib/site'

export const metadata = pageMetadata('/pricing', 'Pricing | blueyvatar', pricingDescription())

export default function PricingPage() {
  return (
    <main>
      <PricingSection headingAs="h1" />
    </main>
  )
}
