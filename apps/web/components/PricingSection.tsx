import { COPY } from '../lib/copy'
import { PRICING, formatPrice } from '../lib/pricing'
import { ButtonLink } from './Button'
import { SectionTitle } from './Type'

const inner = 'mx-auto w-full max-w-[1180px] px-4 sm:px-5'

/** The price cards. Prices come from lib/pricing.ts only. */
export function PricingSection({ headingAs = 'h2' }: { headingAs?: 'h1' | 'h2' }) {
  // Tier names sit one level below the section title so headings never skip a level.
  const Tier = headingAs === 'h1' ? 'h2' : 'h3'
  return (
    <div className={`${inner} py-16`}>
      <section aria-labelledby="pricing-title">
        <SectionTitle id="pricing-title" className="mb-3" as={headingAs}>
          {COPY.pricing.title}
        </SectionTitle>
        <p className="mb-10 max-w-[560px]">{COPY.pricing.lead}</p>
        <ul className="m-0 grid list-none grid-cols-1 gap-8 p-0 md:grid-cols-2 md:gap-6 lg:grid-cols-4">
          {PRICING.map((t) => (
            <li
              key={t.id}
              className={`relative flex flex-col gap-3.5 rounded-bv-card bg-bv-white p-7 ${t.highlighted ? 'border-2 border-bv-black' : 'border-[1.5px] border-bv-line'}`}
            >
              {t.highlighted && (
                <span className="absolute -top-3.5 left-6 rounded-bv-pill bg-bv-orange px-3 py-[5px] text-xs font-semibold tracking-[0.08em] text-bv-black uppercase">
                  {COPY.pricing.badge}
                </span>
              )}
              <Tier className="m-0 font-sans text-sm tracking-[0.08em] text-bv-ink-3 uppercase">{t.name}</Tier>
              <span className="font-display text-[44px] leading-none font-semibold">
                {formatPrice(t.amount)}
                {t.per && <small className="font-sans text-lg font-normal text-bv-ink-3">{COPY.pricing.perMonth}</small>}
              </span>
              <p className="m-0">{COPY.pricing.tiers[t.id].body}</p>
              <ButtonLink href="/login" variant={t.highlighted ? 'primary' : 'secondary'} className="mt-auto">
                {COPY.pricing.tiers[t.id].cta}
              </ButtonLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
