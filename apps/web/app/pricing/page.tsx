import Link from 'next/link'
import { PricingSection } from '../../components/PricingSection'
import { getSiteSettings } from '../../lib/site-settings'
import { pageMetadata, pricingDescription } from '../../lib/site'

export const metadata = pageMetadata('/pricing', 'Pricing', pricingDescription())

/** Limits are admin-editable, so the page re-renders at most every five minutes. */
export const revalidate = 300

export default async function PricingPage() {
  const settings = await getSiteSettings()
  return (
    <main id="main" tabIndex={-1} className="focus:outline-none">
      <PricingSection settings={settings} headingAs="h1" />
      <p className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-5">
        Coming from another avatar service? See the <Link href="/gravatar-alternative">Gravatar comparison</Link> or the <Link href="/migrate-from-gravatar">migration guide</Link>.
      </p>
    </main>
  )
}
