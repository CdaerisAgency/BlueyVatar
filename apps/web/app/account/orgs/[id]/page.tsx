import Link from 'next/link'
import { PageMain } from '../../../../components/Page'
import { requireDid } from '../../../../lib/auth'
import { canManageMembership } from '../../../../lib/orgs/roles'
import { getOrganization, listAudit, listMembers, memberRole, orgLicense } from '../../../../lib/orgs/store'
import { getPool } from '../../../../lib/store'
import AccountNav from '../../AccountNav'
import { changeOrgRole, removeOrgMember } from '../actions'
import { AddMemberForm } from './AddMemberForm'

export const dynamic = 'force-dynamic'
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
        <AccountNav />
        <h1>Organization</h1>
        <p role="alert">You are not a member of that organization.</p>
      </PageMain>
    )
  }
  const owner = canManageMembership(role)
  const [members, lic, audit] = await Promise.all([listMembers(pool, id), orgLicense(pool, id), owner ? listAudit(pool, id) : Promise.resolve([])])
  return (
    <PageMain>
      <AccountNav />
      <h1>{org.name}</h1>
      <p>Signed in as {did}. Your role: {role}.</p>
      {q.error && <p role="alert">{q.error}</p>}
      {q.done && <p role="status">{q.done}</p>}
      <p>
        <Link href={`/account/keys?org=${id}`}>API keys</Link>
        {owner && <> - <Link href={`/account/billing?org=${id}`}>Billing</Link></>}
      </p>
      <p>Members manage keys. Only owners manage billing and membership. Billing stays with the billing owner{lic ? `, ${lic.billingDid}` : ''}.</p>

      <h2>Members ({members.length})</h2>
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
                <button type="submit">Set role</button>
              </form>
            )}{' '}
            {(owner || m.did === did) && (
              <form action={removeOrgMember} className="inline">
                <input type="hidden" name="org" value={id} />
                <input type="hidden" name="member" value={m.did} />
                <button type="submit">{m.did === did ? 'Leave' : 'Remove'}</button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {owner && (
        <>
          <h2>Add a member</h2>
          <p>Enter the person&apos;s atproto DID. They are added right away and can sign in with that account. There are no email invites.</p>
          <AddMemberForm orgId={id} />

          <h2>Activity</h2>
          {audit.length === 0 ? <p>No activity yet.</p> : (
            <ul>
              {audit.map((a) => (
                <li key={a.id}>
                  {a.createdAt.toISOString().slice(0, 16).replace('T', ' ')} {a.action.replace(/_/g, ' ')} by {a.actor ?? 'a deleted account'}
                  {a.targetDid ? ` for ${a.targetDid}` : ''}{a.detail ? ` (${a.detail})` : ''}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageMain>
  )
}
