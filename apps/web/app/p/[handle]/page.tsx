import { cache } from 'react'
import type { Metadata } from 'next'
import AvatarRing from '../../../components/AvatarRing'
import { PageMain } from '../../../components/Page'
import { PLATFORM_LABELS } from '../../../lib/claims'
import { resolvePlan } from '../../../lib/plan'
import { pageAtprotoApps, pageGallery, pageInterests, pageLinks, profileMetadata, type PublicProfile } from '../../../lib/profile-page'
import { ReportForm } from '../../report/ReportForm'

const DELIVERY_URL = process.env.DELIVERY_URL ?? 'http://localhost:3001'
// Link previews are fetched by outside crawlers, so the image needs the public delivery origin.
const PUBLIC_DELIVERY_URL = process.env.PUBLIC_DELIVERY_URL || DELIVERY_URL

const load = cache(async (handle: string): Promise<PublicProfile | null> => {
  const res = await fetch(`${DELIVERY_URL}/profile/${encodeURIComponent(handle)}`, { next: { revalidate: 300 } })
  return res.ok ? ((await res.json()) as PublicProfile) : null
})

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params
  const p = await load(handle)
  if (!p) return { title: 'Profile not found', robots: { index: false } }
  return profileMetadata(p, handle, PUBLIC_DELIVERY_URL)
}

export default async function ProfilePage({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<{ report?: string }> }) {
  const { handle } = await params
  const { report } = await searchParams
  const p = await load(handle)
  if (!p) return <PageMain narrow><h1>Profile not found</h1></PageMain>
  // Only https links render, and accounts the user hid stay off the page.
  const accounts = (p.verifiedAccounts ?? []).filter((a) => !a.hidden && /^https:\/\//.test(a.uri))
  const links = pageLinks(p)
  const apps = pageAtprotoApps(p)
  const interests = pageInterests(p)
  const gallery = pageGallery(p, (await resolvePlan(p.did)) === 'plus')
  const list = 'mt-3 mb-0 flex list-none flex-wrap justify-center gap-x-5 gap-y-2 p-0'
  return (
    <PageMain narrow>
      <div className="flex flex-col items-center text-center [&_p]:mb-2">
        {p.avatar && <AvatarRing src={`${DELIVERY_URL}${p.avatar.url}`} alt="" size={380} referrerPolicy="no-referrer" />}
        <h1 className="mt-5 mb-2">{p.displayName ?? p.handle}</h1>
        {p.pronouns && <p>{p.pronouns}</p>}
        {(p.jobTitle || p.company) && <p>{[p.jobTitle, p.company].filter(Boolean).join(', ')}</p>}
        {p.location && <p>{p.location}</p>}
        {p.timezone && <p>Time zone: {p.timezone}</p>}
        {p.description && <p>{p.description}</p>}
        {interests.length > 0 && <p>Interests: {interests.join(', ')}</p>}
        {links.length > 0 && (
          <ul aria-label="Links" className={list}>
            {links.map((l) => (
              <li key={l.url}>
                <a href={l.url} rel="me nofollow noopener noreferrer">{l.label}</a>
              </li>
            ))}
          </ul>
        )}
        {accounts.length > 0 && (
          <ul aria-label="Verified accounts" className={list}>
            {accounts.map((a) => (
              <li key={a.uri}>
                <a href={a.uri} rel="me noopener" title="Verified by blueyvatar">{PLATFORM_LABELS[a.platform] ?? a.platform} <span aria-label="verified">✓</span></a>
              </li>
            ))}
          </ul>
        )}
        {apps.length > 0 && (
          <p>
            On atproto: <span aria-label="atproto apps">{apps.join(', ')}</span>
          </p>
        )}
      </div>
      {gallery.length > 0 && (
        <ul aria-label="Gallery" className="mt-8 mb-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
          {gallery.map((g) => (
            <li key={g.url} className="m-0">
              <figure className="m-0">
                {/* Signed delivery paths, never raw PDS URLs. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${DELIVERY_URL}${g.url}`} alt={g.caption ?? ''} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full rounded-bv-card border border-solid border-bv-line bg-bv-white object-cover" />
                {g.caption && <figcaption className="mt-1 text-sm text-bv-ink-2">{g.caption}</figcaption>}
              </figure>
            </li>
          ))}
        </ul>
      )}
      <ReportForm did={p.did} source="profile" back={`/p/${encodeURIComponent(handle)}`} status={report} />
    </PageMain>
  )
}
