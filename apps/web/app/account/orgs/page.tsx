import Link from 'next/link'
import { PageMain } from '../../../components/Page'
import { requireDid } from '../../../lib/auth'
import { listOrganizations } from '../../../lib/orgs/store'
import { getPool } from '../../../lib/store'
import { CreateOrgForm } from './CreateOrgForm'


export const dynamic = 'force-dynamic'
export const metadata = { title: 'Organizations' }

export default async function OrgsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const did = await requireDid('/account/orgs')
  const { error } = await searchParams
  const pool = getPool()
  const orgs = pool ? await listOrganizations(pool, did) : []
  return (
    <PageMain>
      <h1>Organizations</h1>
      <p>Signed in as {did}</p>
      {error && <p role="alert">{error}</p>}
      <p>An organization shares one license, with its API keys, among several people. Members are added by their atproto DID.</p>
      {!pool && <p>Organizations need the database, which is not configured here.</p>}
      {orgs.length === 0 ? <p>You are not in any organization yet.</p> : (
        <ul>
          {orgs.map((o) => (
            <li key={o.orgId}>
              <Link href={`/account/orgs/${o.orgId}`}>{o.name}</Link> ({o.role}) - <Link href={`/account/keys?org=${o.orgId}`}>Keys</Link>
              {o.role === 'owner' && <> - <Link href={`/account/billing?org=${o.orgId}`}>Billing</Link></>}
            </li>
          ))}
        </ul>
      )}
      <h2>Create an organization</h2>
      <p>You become its first owner and its billing owner. The Business tier ($49 per month, 25 keys) is for organizations.</p>
      <CreateOrgForm />
    </PageMain>
  )
}
