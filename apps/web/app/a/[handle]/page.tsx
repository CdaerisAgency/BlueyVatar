import type { PublicProfile } from '../../../lib/profile-page'
import { ReportForm } from '../../report/ReportForm'

const DELIVERY_URL = process.env.DELIVERY_URL ?? 'http://localhost:3001'

/** Hosted avatar page: the avatar at full size with a report link. */
export default async function AvatarPage({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<{ report?: string }> }) {
  const { handle } = await params
  const { report } = await searchParams
  const res = await fetch(`${DELIVERY_URL}/profile/${encodeURIComponent(handle)}`, { next: { revalidate: 300 } })
  const p = res.ok ? ((await res.json()) as PublicProfile) : null
  if (!p || !p.avatar) return <main><h1>Avatar not found</h1></main>
  return (
    <main>
      <img src={`${DELIVERY_URL}${p.avatar.url}`} alt="" width={256} height={256} referrerPolicy="no-referrer" />
      <h1>{p.displayName ?? p.handle ?? handle}</h1>
      <p><a href={`/p/${encodeURIComponent(handle)}`}>View profile</a></p>
      <ReportForm did={p.did} source="avatar" back={`/a/${encodeURIComponent(handle)}`} status={report} />
    </main>
  )
}
