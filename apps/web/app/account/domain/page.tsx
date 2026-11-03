import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { cfSaasConfig, fallbackOrigin, getHostname, type HostnameState } from '../../../lib/cf-saas'
import { getDomainStore } from '../../../lib/domain-store'
import { planFor } from '../../../lib/records'
import AccountNav from '../AccountNav'
import { addDomain, removeDomain } from './actions'
import { PollRefresh } from './PollRefresh'

export const dynamic = 'force-dynamic'

export default async function DomainPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const did = await currentDid()
  if (!did) redirect('/login')
  const { error } = await searchParams
  const cfg = cfSaasConfig()
  const target = fallbackOrigin()
  const plus = planFor(did) === 'plus'
  const store = getDomainStore()
  let row = await store.get(did)

  // Poll Cloudflare for the current state and the TXT records to show.
  let live: HostnameState | null = null
  if (row && cfg) {
    try {
      live = await getHostname(cfg, row.cfId)
      if (live.status !== row.status) {
        await store.setStatus(did, live.status)
        row = { ...row, status: live.status }
      }
    } catch {
      // Keep the stored state; the next refresh retries.
    }
  }

  return (
    <main>
      <AccountNav />
      <h1>Custom profile domain</h1>
      <p>Serve your profile from your own subdomain, such as me.example.com.</p>
      {error && <p role="alert">{error}</p>}

      {!cfg || !target ? (
        <p>Custom domains are not available yet. Check back soon.</p>
      ) : !plus && !row ? (
        <div role="note" style={{ border: '1px solid currentColor', padding: 12 }}>
          <p>
            <strong>Custom profile domains are part of the Plus plan.</strong> You are on the Free plan, so this page is locked.
          </p>
        </div>
      ) : null}

      {cfg && target && row && (
        <section>
          <h2>{row.hostname}</h2>
          <p>
            Status:{' '}
            {row.status === 'active'
              ? 'Active. Your profile is served from this domain.'
              : row.status === 'failed'
                ? 'Failed. Remove the domain and check the records below before trying again.'
                : 'Waiting for DNS. This page checks every 15 seconds.'}
          </p>
          {row.status !== 'active' && (
            <>
              <p>Add these records at your DNS provider.</p>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Name</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>CNAME</td>
                    <td>
                      <code>{row.hostname}</code>
                    </td>
                    <td>
                      <code>{target}</code>
                    </td>
                  </tr>
                  {live?.records.map((r) => (
                    <tr key={`${r.name}${r.value}`}>
                      <td>TXT ({r.purpose === 'hostname' ? 'hostname validation' : 'certificate validation'})</td>
                      <td>
                        <code>{r.name}</code>
                      </td>
                      <td>
                        <code>{r.value}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {live && live.records.length === 0 && <p>The validation records are still being generated. They appear here shortly.</p>}
              {live?.errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </>
          )}
          <PollRefresh active={row.status === 'pending'} />
          <form action={removeDomain}>
            <button type="submit">Remove domain</button>
          </form>
        </section>
      )}

      {cfg && target && !row && plus && (
        <form action={addDomain}>
          <label>
            Subdomain you own{' '}
            <input name="hostname" placeholder="me.example.com" required autoComplete="off" spellCheck={false} />
          </label>{' '}
          <button type="submit">Add domain</button>
        </form>
      )}

      <h2>Using a root domain</h2>
      <p>
        Root domains such as example.com cannot be served this way. Instead, set your Bluesky handle to your domain. Once your handle is the domain,
        /p/{'{domain}'} on blueyvatar shows your profile.
      </p>
    </main>
  )
}
