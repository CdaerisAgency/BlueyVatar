import { cache } from 'react'
import type { Metadata } from 'next'
import { ReportForm } from '../../report/ReportForm'
import { pageInterests, pageLinks, profileMetadata, type PublicProfile } from '../../../lib/profile-page'

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
  if (!p) return <main><h1>Profile not found</h1></main>
  // Only https links render, and accounts the user hid stay off the page.
  const accounts = (p.verifiedAccounts ?? []).filter((a) => !a.hidden && /^https:\/\//.test(a.uri))
  const links = pageLinks(p)
  const interests = pageInterests(p)
  return (
    <main>
      {p.avatar && <img src={`${DELIVERY_URL}${p.avatar.url}`} alt="" width={128} height={128} referrerPolicy="no-referrer" />}
      <h1>{p.displayName ?? p.handle}</h1>
      {p.pronouns && <p>{p.pronouns}</p>}
      {(p.jobTitle || p.company) && <p>{[p.jobTitle, p.company].filter(Boolean).join(', ')}</p>}
      {p.location && <p>{p.location}</p>}
      {p.timezone && <p>Time zone: {p.timezone}</p>}
      {p.description && <p>{p.description}</p>}
      {interests.length > 0 && <p>Interests: {interests.join(', ')}</p>}
      {links.length > 0 && (
        <ul aria-label="Links">
          {links.map((l) => (
            <li key={l.url}>
              <a href={l.url} rel="me nofollow noopener noreferrer">{l.label}</a>
            </li>
          ))}
        </ul>
      )}
      {accounts.length > 0 && (
        <ul aria-label="Verified accounts">
          {accounts.map((a) => (
            <li key={a.uri}>
              <a href={a.uri} rel="me noopener">{a.platform}</a>
            </li>
          ))}
        </ul>
      )}
      <ReportForm did={p.did} source="profile" back={`/p/${encodeURIComponent(handle)}`} status={report} />
    </main>
  )
}
