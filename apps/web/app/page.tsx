import Link from 'next/link'
import AvatarRing from '../components/AvatarRing'
import { ButtonLink } from '../components/Button'
import { Eyebrow, SectionTitle } from '../components/Type'
import { PricingHashRedirect } from '../components/PricingHashRedirect'
import { COPY } from '../lib/copy'
import { pageMetadata } from '../lib/site'

const inner = 'mx-auto w-full max-w-[1180px] px-4 sm:px-5'

export const metadata = pageMetadata('/', 'blueyvatar | Avatars and profiles in your atproto repository', 'Avatars and profiles that live in your atproto repository. Free for people, with a simple API for apps.')

export default function Home() {
  return (
    <main>
      <PricingHashRedirect />
      <div className={`${inner} grid grid-cols-1 items-center gap-12 pt-8 pb-12 md:grid-cols-[1.2fr_1fr] md:pt-14`}>
        <div className="flex flex-col items-start gap-[22px]">
          <Eyebrow>{COPY.hero.eyebrow}</Eyebrow>
          <h1 className="m-0 text-[clamp(38px,9vw,64px)]">{COPY.hero.title}</h1>
          <p className="m-0 max-w-[520px] text-lg sm:text-xl">{COPY.hero.lead}</p>
          <div className="flex flex-wrap gap-3.5">
            <ButtonLink href="/login" variant="primary" size="lg">
              {COPY.hero.primary}
            </ButtonLink>
            <ButtonLink href="/docs" size="lg">
              {COPY.hero.secondary}
            </ButtonLink>
          </div>
          <p className="m-0 text-sm text-bv-ink-3">{COPY.hero.note}</p>
        </div>
        <div className="order-first flex justify-center md:order-none">
          <div className="relative w-[380px] max-w-full">
            <AvatarRing src="/logo.jpg" alt={COPY.hero.avatarAlt} size={380} />
            <span className="absolute right-0 bottom-[11%] flex items-center gap-2 rounded-bv-pill border-[1.5px] border-bv-black bg-bv-white px-3.5 py-2 text-[13px] font-semibold text-bv-black">
              <span aria-hidden="true" className="size-2.5 flex-none rounded-full bg-bv-orange" />
              {COPY.hero.chip}
            </span>
          </div>
        </div>
      </div>

      <div className={inner}>
        <div aria-hidden="true" className="h-1.5 w-[120px] rounded-bv-pill bg-bv-orange" />
      </div>

      <div id="how" className={`${inner} py-16`}>
        <section aria-labelledby="how-title">
          <SectionTitle id="how-title">{COPY.how.title}</SectionTitle>
          <ol className="m-0 grid list-none grid-cols-1 gap-8 p-0 md:grid-cols-3">
            {COPY.how.steps.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-3 border-t-[1.5px] border-bv-black pt-5">
                <span aria-hidden="true" className="font-display text-[28px] leading-none font-semibold text-bv-orange-deep">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="m-0">{s.title}</h3>
                <p className="m-0">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div id="dev" className="bg-bv-black text-bv-cream">
        <section aria-labelledby="dev-title" className={`${inner} grid grid-cols-1 items-center gap-12 py-16 md:grid-cols-2`}>
          <div>
            <Eyebrow onDark>{COPY.dev.eyebrow}</Eyebrow>
            <h2 id="dev-title" className="mt-4 mb-4 text-[clamp(30px,7vw,40px)]">
              {COPY.dev.title}
            </h2>
            <p className="max-w-[480px] text-bv-line">{COPY.dev.body}</p>
            <Link
              href="/docs"
              className="font-semibold text-bv-cream underline decoration-bv-orange decoration-2 underline-offset-[6px] hover:text-bv-cream hover:decoration-4 focus-visible:outline-bv-cream"
            >
              {COPY.dev.link}
            </Link>
          </div>
          <pre
            tabIndex={0}
            aria-label="Sample requests"
            className="m-0 overflow-x-auto rounded-xl border-0 bg-bv-code-bg p-6 font-mono text-sm leading-[1.7] text-bv-cream focus-visible:outline-bv-cream"
          >
            <code className="text-[1em]">
              {COPY.dev.samples.map((s) => (
                <span className="mb-3.5 block whitespace-pre last:mb-0" key={s.url}>
                  <span className="block text-bv-line">{s.comment}</span>
                  <span className="mr-2 inline-block rounded-bv-pill bg-bv-orange px-2 text-xs font-semibold tracking-[0.06em] text-bv-black">GET</span>
                  {s.url}
                </span>
              ))}
            </code>
          </pre>
        </section>
      </div>
    </main>
  )
}
