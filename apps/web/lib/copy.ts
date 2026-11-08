/**
 * All marketing copy lives here so it can be swapped in one edit.
 * PLACEHOLDER: this is the approved mockup's copy, to be replaced by Start with Why copy (Why, How, What).
 * Prices are not here. They come from ./pricing.ts.
 */
export const COPY = {
  brand: 'blueyvatar',
  nav: { skip: 'Skip to main content', how: 'How it works', developers: 'Developers', docs: 'Docs', pricing: 'Pricing', integrations: 'Integrations', signIn: 'Sign in with Bluesky' },
  hero: {
    eyebrow: 'One avatar. Every app.',
    title: 'Your face, carried by your own account.',
    lead: 'blueyvatar stores your avatar and profile in your atproto repository, so any site that knows your email or handle can show the real you. Change it once and it changes everywhere.',
    primary: 'Claim your avatar',
    secondary: 'Read the docs',
    note: 'Free for everyone. No password, no new account. Sign in with the Bluesky account you already have.',
    avatarAlt: 'Example avatar',
  },
  how: {
    title: 'You own it. We just deliver it.',
    steps: [
      { title: 'Sign in with Bluesky', body: 'Log in with your existing handle. blueyvatar asks only for permission to write its own records to your repository.' },
      { title: 'Upload and rate', body: 'Add one avatar or several, pick a default, add alt text, and set a rating so sites can request only what fits their audience.' },
      { title: 'Show up everywhere', body: 'Any site that supports blueyvatar can fetch your avatar by email hash or handle, resized and cached at the edge.' },
    ],
  },
  dev: {
    eyebrow: 'For developers',
    title: 'One URL. Any size.',
    body: 'Drop-in compatible with the Gravatar URL shape you already use. Add a size, a rating, and a fallback, and get a cached image back in milliseconds.',
    link: 'Open the API reference',
    samples: [
      { comment: '// avatar by email hash', url: 'https://img.blueyvatar.com/avatar/<sha256>?s=128&r=pg' },
      { comment: '// avatar by handle', url: 'https://img.blueyvatar.com/u/alice.example.com?s=256' },
      { comment: '// profile card JSON', url: 'https://img.blueyvatar.com/profile/alice.example.com' },
    ],
  },
  pricing: {
    title: 'Free for people. Fair for apps.',
    lead: 'Being seen is always free. Plus adds extras for people who want them, and developers pay only when their traffic grows.',
    badge: 'Most popular',
    perMonth: '/mo',
    tiers: {
      free: { body: '1,000 requests a day. Enough for a personal site or a side project.', cta: 'Get a key' },
      plus: { body: '20 avatar images, a profile gallery, a custom profile domain, and up to 20 verified accounts.', cta: 'Start Plus' },
      pro: { body: '50,000 requests a month, hovercards, and priority cache warming.', cta: 'Start Pro' },
      business: { body: '1 million requests a month, custom domains, and a support contact.', cta: 'Start Business' },
    },
  },
  // Only destinations that exist today. Add Status and Terms here when those pages ship.
  footer: {
    tagline: 'blueyvatar. Built on atproto.',
    // Wording follows Stripe Climate guidance: state the share of revenue, make no carbon-neutral or donation claim.
    // Swap in the official badge image from the Stripe Dashboard (Climate page) once it is downloaded.
    climate: { text: 'We contribute 1% of revenue to carbon removal through', linkLabel: 'Stripe Climate', href: 'https://stripe.com/climate' },
    links: [
      { label: 'Developers', href: '/#dev' },
      { label: 'Docs', href: '/docs' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Integrations', href: '/integrations' },
      { label: 'Gravatar alternative', href: '/gravatar-alternative' },
      { label: 'Migrate from Gravatar', href: '/migrate-from-gravatar' },
      { label: 'Changelog', href: '/changelog' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Accessibility', href: '/accessibility' },
      { label: 'Sign in', href: '/login' },
    ],
  },
  login: {
    title: 'Sign in',
    lead: 'Use the Bluesky account you already have.',
    label: 'Your atproto handle. Format: username.server.server',
    placeholder: 'username.bsky.social',
    help: 'Example: username.bsky.social. If you use your own domain as a handle, enter it the same way, such as alice.example.com.',
    submit: 'Continue',
  },
  notFound: { title: 'Page not found', body: 'That page does not exist.', home: 'Back to home' },
  error: { title: 'Something went wrong', body: 'Try again, or come back in a moment.', retry: 'Try again' },
} as const
