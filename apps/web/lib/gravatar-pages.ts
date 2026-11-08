/** Shared content for /gravatar-alternative and /migrate-from-gravatar (issue #181). Facts about Gravatar cite Gravatar's own documentation only. */
import { avatarUrl, fromGravatarUrl, DEFAULT_BASE_URL } from '@blueyvatar/avatar'

/** Gravatar documentation pages cited on the site. */
export const GRAVATAR_DOCS = {
  images: 'https://docs.gravatar.com/api/avatars/images/',
  sdkImages: 'https://docs.gravatar.com/sdk/images/',
} as const

/** A made-up hash for examples. It is 64 hex characters. */
export const EXAMPLE_HASH = '0000000000000000000000000000000000000000000000000000000000000000'
export const EXAMPLE_GRAVATAR_URL = `https://gravatar.com/avatar/${EXAMPLE_HASH}?s=200&r=pg&d=identicon`

/** The same image URL on blueyvatar, converted by the shared helper. */
export function exampleMigration() {
  const m = fromGravatarUrl(EXAMPLE_GRAVATAR_URL, { baseUrl: DEFAULT_BASE_URL })
  return { url: avatarUrl(m.options), notes: m.notes }
}

export interface Faq { q: string; a: string }

export const FAQS: readonly Faq[] = [
  {
    q: 'Does my existing image URL keep working if I only change the host?',
    a: 'For the common parameters, yes. Gravatar documents an avatar URL of the form gravatar.com/avatar/HASH with size, default, rating, and force-default parameters. BlueyVatar accepts the same parameters on /avatar/{hash}. Sizes above your plan cap are clamped and reported in a response header.',
  },
  {
    q: 'Where is my avatar stored?',
    a: 'In your own atproto repository, as a record you control. Sign in with the atproto account you already have.',
  },
  {
    q: 'How do I bring my image over?',
    a: 'Sign in, link your email, then use the import page to fetch the image. You confirm its rating before it is saved to your repository, where it is public.',
  },
  {
    q: 'Which email hash does BlueyVatar accept?',
    a: 'A SHA-256 or MD5 hash. A raw email address is always rejected. Gravatar documents a SHA256 hash of the email address.',
  },
  {
    q: 'Are there size limits?',
    a: 'Sizes run from 1 to 2048 pixels on Business and Enterprise. Free is capped at 512 and Plus at 1024. Gravatar documents a range of 1 to 2048 pixels.',
  },
  {
    q: 'Do ratings map one to one?',
    a: 'Not always. BlueyVatar maps ratings from atproto self-labels, and its definitions differ from Gravatar documented definitions. Check the rating when you import an image.',
  },
  {
    q: 'Can each email have its own image?',
    a: 'No. BlueyVatar keeps one avatar per account, shared by every linked email hash.',
  },
  {
    q: 'Is BlueyVatar affiliated with Gravatar?',
    a: 'No. Gravatar is a name that belongs to its owner. This page describes how BlueyVatar works and links to Gravatar documentation for facts about Gravatar.',
  },
]

export function faqJsonLd(faqs: readonly Faq[] = FAQS): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }
}
