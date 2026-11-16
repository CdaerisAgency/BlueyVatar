import Link from 'next/link'
import { BackLink, EmptyState, Notices, PageHeader, PageMain, Section } from '../../../../components/Page'
import { Button } from '../../../../components/Button'
import { SignedInAs } from '../../../../components/SignedInAs'
import { requireDid } from '../../../../lib/auth'
import { canManageMembership } from '../../../../lib/orgs/roles'
import { getOrganization, listAudit, listMembers, memberRole, orgLicense } from '../../../../lib/orgs/store'
import { getPool } from '../../../../lib/store'
import { changeOrgRole, removeOrgMember } from '../actions'
import { AddMemberForm } from './AddMemberForm'


export const metadata = { title: 'Organization' }

export default async function OrgPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { id } = await params
  const did = await requireDid(`/account/orgs/${id}`)
  const q = await searchParams
  const pool = getPool()
  const role = pool ? await memberRole(pool, id, did) : null
  const org = pool && role ? await getOrganization(pool, id) : null
  if (!pool || !org || !role) {
    return (
      <PageMain>
        <BackLink href="/account/orgs">Back to organizations</BackLink>
        <PageHeader title="Organization" intro="Members, roles, and activity for one organization." />
        <p role="alert">You are not a member of that organization.</p>
      </PageMain>
    )
  }
  const owner = canManageMembership(role)
  const [members, lic, audit] = await Promise.all([listMembers(pool, id), orgLicense(pool, id), owner ? listAudit(pool, id) : Promise.resolve([])])
  return (
    <PageMain>
      <BackLink href="/account/orgs">Back to organizations</BackLink>
      <PageHeader title={`${org.name}`} intro="Members manage keys. Only owners manage billing and membership." />
      <SignedInAs did={did} />
      <p>Your role: {role}.</p>
      <Notices error={q.error} done={q.done} />
      <p>
        <Link href={`/account/keys?org=${id}`}>API keys</Link>
        {owner && <> - <Link href={`/account/billing?org=${id}`}>Plan and billing</Link></>}
      </p>
      <p>Billing stays with the billing owner{lic ? `, ${lic.billingDid}` : ''}.</p>

      <Section title={`Members (${members.length})`}>
      <ul>
        {members.map((m) => (
          <li key={m.did} className="mb-3">
            <code>{m.did}</code> ({m.role}{m.did === lic?.billingDid ? ', billing owner' : ''}) added {m.addedAt.toISOString().slice(0, 10)}
            {owner && (
              <form action={changeOrgRole} className="inline">
                <input type="hidden" name="org" value={id} />
                <input type="hidden" name="member" value={m.did} />{' '}
                <select name="role" defaultValue={m.role} aria-label={`Role for ${m.did}`}>
                  <option value="member">member</option>
                  <option value="owner">owner</option>
                </select>{' '}
                <Button type="submit">Set role</Button>
              </form>
            )}{' '}
            {(owner || m.did === did) && (
              <form action={removeOrgMember} className="inline">
                <input type="hidden" name="org" value={id} />
                <input type="hidden" name="member" value={m.did} />
                <Button type="submit" variant="danger">{m.did === did ? 'Leave' : 'Remove'}</Button>
              </form>
            )}
          </li>
        ))}
      </ul>
      </Section>

      {owner && (
        <>
          <Section title="Add a member" intro="Enter the person's atproto DID. They are added right away and can sign in with that account. There are no email invites.">
            <AddMemberForm orgId={id} />
          </Section>

          <Section title="Activity">
          {audit.length === 0 ? <EmptyState>No activity yet.</EmptyState> : (
            <ul>
              {audit.map((a) => (
                <li key={a.id}>
                  {a.createdAt.toISOString().slice(0, 16).replace('T', ' ')} {a.action.replace(/_/g, ' ')} by {a.actor ?? 'a deleted account'}
                  {a.targetDid ? ` for ${a.targetDid}` : ''}{a.detail ? ` (${a.detail})` : ''}
                </li>
              ))}
            </ul>
          )}
          </Section>
        </>
      )}
    </PageMain>
  )
}
