import type { SiteSettings } from '@blueyvatar/core/settings'
import { formatVolume } from '../format-volume'

/** "Show avatars on your site" hub at the top of /docs. Slugs match INTEGRATIONS in scripts/build-docs.mjs. */
export const GUIDE_HUB_TITLE = 'Show avatars on your site'
export const GUIDE_HUB_LEAD = 'Pick your platform. Each guide is a short, copy-and-paste setup.'
export const GUIDE_HUB: { slug: string; name: string; change: string; minutes: number }[] = [
  { slug: 'html', name: 'Plain HTML', change: 'Use the avatar URL in an img tag', minutes: 2 },
  { slug: 'wordpress', name: 'WordPress', change: 'Install the BlueyVatar plugin', minutes: 5 },
  { slug: 'ghost', name: 'Ghost', change: 'Add the avatar URL to your theme', minutes: 5 },
  { slug: 'discourse', name: 'Discourse', change: 'Set the hidden gravatar_base_url setting', minutes: 5 },
  { slug: 'gitlab', name: 'GitLab', change: 'Set gravatar_plain_url and gravatar_ssl_url in gitlab.rb', minutes: 5 },
  { slug: 'gitea', name: 'Gitea', change: 'Set GRAVATAR_SOURCE in app.ini', minutes: 3 },
  { slug: 'forgejo', name: 'Forgejo', change: 'Set GRAVATAR_SOURCE in app.ini', minutes: 3 },
  { slug: 'redmine', name: 'Redmine', change: 'Set avatar_server_url in configuration.yml', minutes: 3 },
]

/** One-line pointer on /integrations. The guide list itself lives only in the /docs hub. */
export const INTEGRATIONS_GUIDES_LEAD = 'Guides for WordPress, Discourse, GitLab and more are on'
export const INTEGRATIONS_GUIDES_LINK = 'the docs page'

/** Copy for the public pages. Prices are not here. They come from ../pricing.ts. Limits come from admin settings, see planBodies(). */
export const PUBLIC_COPY = {
  nav: { skip: 'Skip to main content', how: 'How it works', developers: 'Developers', docs: 'Docs', pricing: 'Pricing', integrations: 'Integrations', signIn: 'Sign in' },
  hero: {
    eyebrow: 'One avatar. Every app.',
    title: 'Your face, carried by your own account.',
    lead: 'BlueyVatar stores your avatar and profile in your atproto repository, so any site that knows your email or handle can show the real you. Change it once and it changes everywhere.',
    primary: 'Set up your avatar',
    secondary: 'Read the docs',
    note: 'Free for everyone. No password, no new account. Sign in with the atproto account you already have.',
    avatarAlt: 'Example avatar',
  },
  how: {
    title: 'You own it. We just deliver it.',
    steps: [
      { title: 'Sign in with your account', body: 'Log in with your existing handle, on any atproto server. BlueyVatar asks for permission to save its own records and to change the picture on your profile. It does not change anything else on your profile.' },
      { title: 'Upload and rate', body: 'Add one avatar or several, pick a default, add alt text, and set a rating so sites can request only what fits their audience.' },
      { title: 'Show up everywhere', body: 'Any site that supports BlueyVatar can fetch your avatar by email hash or handle, resized and cached at the edge.' },
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
    lead: 'Being seen is always free. Plus adds extras for people and small apps, and Business is for teams with heavy traffic.',
    badge: 'Most popular',
    perMonth: '/mo',
    tiers: {
      free: { cta: 'Get a key' },
      plus: { cta: 'Start Plus' },
      business: { cta: 'Start Business' },
    },
  },
  // Only destinations that exist today. Add Status and Terms here when those pages ship.
  footer: {
    tagline: 'BlueyVatar. Built on atproto.',
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
      { label: 'Sign in', href: '/login' }, // Hidden for signed-in visitors by SiteFooter.
    ],
  },
  login: {
    title: 'Sign in',
    lead: 'Use the atproto account you already have, on any server.',
    label: 'Your atproto handle. Format: username.server.server',
    placeholder: 'username.bsky.social',
    help: 'Example: username.bsky.social. If you use your own domain as a handle, enter it the same way, such as alice.example.com.',
    submit: 'Continue',
  },
  notFound: { title: 'Page not found', body: 'That page does not exist.', home: 'Back to home' },
  error: { title: 'Something went wrong', body: 'Try again, or come back in a moment.', retry: 'Try again' },
} as const

/** The plan card lines. The request limits and profile access are the live admin-set values. */
export function planBodies(s: SiteSettings): { free: string; plus: string; business: string } {
  const cards = 'hovercards'
  const plusItems = [
    '20 avatar images',
    'a profile gallery',
    'a custom profile domain',
    'up to 20 linked accounts',
    `${formatVolume(s.keyedMonthly.plus)} requests a month`,
    ...(s.profileAccess.plus ? [cards] : []),
    'priority cache warming',
  ]
  const businessItems = [
    `${formatVolume(s.keyedMonthly.business)} requests a month`,
    ...(s.profileAccess.business ? [cards] : []),
    'custom domains',
    'a support contact',
  ]
  const list = (items: string[]) => `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
  return {
    free: `${formatVolume(s.keyedDaily.free)} requests a day. Enough for a personal site or a side project.${s.profileAccess.free ? ' Includes hovercards.' : ''}`,
    plus: `Everything in Free, plus ${list(plusItems)}.`,
    business: `Everything in Plus, plus ${list(businessItems)}.`,
  }
}
