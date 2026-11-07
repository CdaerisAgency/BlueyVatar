import Link from 'next/link'
import AvatarRing from '../components/AvatarRing'
import { COPY } from '../lib/copy'
import { PRICING } from '../lib/pricing'

export default function Home() {
  return (
    <main className="bv-wide">
      <div className="bv-inner bv-hero">
        <div className="bv-hero-copy">
          <span className="bv-eyebrow">{COPY.hero.eyebrow}</span>
          <h1>{COPY.hero.title}</h1>
          <p className="bv-lead">{COPY.hero.lead}</p>
          <div className="bv-actions">
            <Link href="/login" className="bv-btn bv-primary bv-lg">
              {COPY.hero.primary}
            </Link>
            <Link href="/#dev" className="bv-btn bv-lg">
              {COPY.hero.secondary}
            </Link>
          </div>
          <p className="bv-note-small">{COPY.hero.note}</p>
        </div>
        <div className="bv-hero-art">
          <div className="bv-hero-art-inner">
            <AvatarRing src="/logo.jpg" alt={COPY.hero.avatarAlt} size={380} />
            <span className="bv-chip">
              <span className="bv-dot" aria-hidden="true" />
              {COPY.hero.chip}
            </span>
          </div>
        </div>
      </div>

      <div className="bv-inner">
        <div className="bv-rule" aria-hidden="true" />
      </div>

      <div id="how" className="bv-inner bv-section">
        <section aria-labelledby="how-title">
          <h2 id="how-title">{COPY.how.title}</h2>
          <ol className="bv-steps">
            {COPY.how.steps.map((s, i) => (
              <li key={s.title}>
                <span className="bv-num" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div id="dev" className="bv-band">
        <section className="bv-inner" aria-labelledby="dev-title">
          <div>
            <span className="bv-eyebrow">
              <span className="bv-dot" aria-hidden="true" />
              {COPY.dev.eyebrow}
            </span>
            <h2 id="dev-title">{COPY.dev.title}</h2>
            <p>{COPY.dev.body}</p>
            <Link href="/#dev">{COPY.dev.link}</Link>
          </div>
          <pre className="bv-code" tabIndex={0} aria-label="Sample requests">
            <code>
              {COPY.dev.samples.map((s) => (
                <span className="bv-line" key={s.url}>
                  <span className="bv-comment">{s.comment}</span>
                  <span className="bv-method">GET</span>
                  {s.url}
                </span>
              ))}
            </code>
          </pre>
        </section>
      </div>

      <div id="pricing" className="bv-inner bv-section">
        <section aria-labelledby="pricing-title">
          <h2 id="pricing-title" style={{ marginBottom: 12 }}>
            {COPY.pricing.title}
          </h2>
          <p style={{ maxWidth: 560, marginBottom: 40 }}>{COPY.pricing.lead}</p>
          <ul className="bv-prices">
            {PRICING.map((t) => (
              <li key={t.id} className={t.highlighted ? 'bv-price bv-hl' : 'bv-price'}>
                {t.highlighted && <span className="bv-badge">{COPY.pricing.badge}</span>}
                <h3>{t.name}</h3>
                <span className="bv-amount">
                  ${t.amount}
                  {t.per && <small>{COPY.pricing.perMonth}</small>}
                </span>
                <p>{COPY.pricing.tiers[t.id].body}</p>
                <Link href="/login" className={t.highlighted ? 'bv-btn bv-primary' : 'bv-btn'}>
                  {COPY.pricing.tiers[t.id].cta}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}
