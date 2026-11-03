const DELIVERY_URL = process.env.DELIVERY_URL ?? 'http://localhost:3001'

interface Profile {
  did: string
  handle: string | null
  displayName: string | null
  description: string | null
  avatar: { url: string } | null
  jobTitle: string | null
  company: string | null
  location: string | null
  pronouns: string | null
}

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const res = await fetch(`${DELIVERY_URL}/profile/${encodeURIComponent(handle)}`, { next: { revalidate: 300 } })
  if (!res.ok) return <main><h1>Profile not found</h1></main>
  const p = (await res.json()) as Profile
  return (
    <main>
      {p.avatar && <img src={`${DELIVERY_URL}${p.avatar.url}`} alt="" width={128} height={128} referrerPolicy="no-referrer" />}
      <h1>{p.displayName ?? p.handle}</h1>
      {p.pronouns && <p>{p.pronouns}</p>}
      {(p.jobTitle || p.company) && <p>{[p.jobTitle, p.company].filter(Boolean).join(', ')}</p>}
      {p.location && <p>{p.location}</p>}
      {p.description && <p>{p.description}</p>}
    </main>
  )
}
