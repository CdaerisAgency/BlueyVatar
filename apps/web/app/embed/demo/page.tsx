import { PageMain } from '../../../components/Page'
import { cleanId } from '@blueyvatar/hovercards'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Hovercard demo' }

/** Demo for the embeddable hovercard. Visit /embed/demo?token=pk_...&id=alice.example.com */
export default async function HovercardDemo({ searchParams }: { searchParams: Promise<{ token?: string; id?: string }> }) {
  const { token = '', id = '' } = await searchParams
  const handle = cleanId(id) ?? 'example.bsky.social'
  const api = process.env.PUBLIC_DELIVERY_URL || process.env.DELIVERY_URL || ''
  return (
    <PageMain>
      <h1>Hovercard demo</h1>
      <p>
        Hover or focus the avatar below. Press Enter to move into the card, and Escape to close it. Hovercards need a publishable key from a Business or Enterprise license,
        passed as <code>data-token</code>. {token ? null : 'Add ?token=pk_... to this page URL to try it.'}
      </p>
      {/* The embed marks avatars with data-blueyvatar. Its value is a handle, a DID, or an email hash. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${api}/u/${encodeURIComponent(handle)}?s=96`} alt={handle} width={96} height={96} data-blueyvatar={handle} referrerPolicy="no-referrer" className="rounded-full" />
      <h2>Install</h2>
      <pre>{`<script src="/embed/hovercard.js" data-key="pk_..." defer></script>\n<img src="..." alt="..." data-blueyvatar="handle-or-did-or-hash">`}</pre>
      <script src="/embed/hovercard.js" data-key={token} {...(api ? { 'data-api': api } : {})} defer />
    </PageMain>
  )
}
