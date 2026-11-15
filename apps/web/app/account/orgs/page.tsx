import Link from 'next/link'
import { EmptyState, Notices, PageHeader, PageMain, Section } from '../../../components/Page'
import { requireDid } from '../../../lib/auth'
import { listOrganizations } from '../../../lib/orgs/store'
import { getPool } from '../../../lib/store'
import { CreateOrgForm } from './CreateOrgForm'


export const metadata = { title: 'Organizations' }

export default async function OrgsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const did = await requireDid('/account/orgs')
  const { error } = await searchParams
  const pool = getPool()
  const orgs = pool ? await listOrganizations(pool, did) : []
  return (
    <PageMain>
      <PageHeader title="Organizations" intro="An organization shares one license, with its API keys, among several people." />
      <p>Signed in as {did}</p>
      <Notices error={error} />
      {!pool && <p>Organizations need the database, which is not configured here.</p>}
      {orgs.length === 0 ? <EmptyState>You are not in any organization yet. Create one below.</EmptyState> : (
        <ul>
          {orgs.map((o) => (
            <li key={o.orgId}>
              <Link href={`/account/orgs/${o.orgId}`}>{o.name}</Link> ({o.role}) - <Link href={`/account/keys?org=${o.orgId}`}>API keys</Link>
              {o.role === 'owner' && <> - <Link href={`/account/billing?org=${o.orgId}`}>Plan and billing</Link></>}
            </li>
          ))}
        </ul>
      )}
      <Section title="Create an organization" intro="You become its first owner and its billing owner. The Business tier ($49 per month, 25 keys) is for organizations. Members are added by their atproto DID.">
        <CreateOrgForm />
      </Section>
    </PageMain>
  )
}
