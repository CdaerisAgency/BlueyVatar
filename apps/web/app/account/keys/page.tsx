import { COPY } from '../../../lib/copy'
import { PageHeader, PageMain, Section } from '../../../components/Page'
import { SignedInAs } from '../../../components/SignedInAs'
import { ENTITLEMENTS } from '@blueyvatar/core'
import Link from 'next/link'
import { requireDid } from '../../../lib/auth'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { checkKeyLimit } from '../../../lib/keys'
import { isExpired } from '../../../lib/key-expiry'
import { isScope, resolveScope } from '../../../lib/orgs/scope'
import { getOrganization } from '../../../lib/orgs/store'
import { getPool } from '../../../lib/store'
import { CreateKeyForm, KeyActions } from './KeyControls'


export default async function KeysPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const did = await requireDid('/account/keys')
  const orgId = (await searchParams).org || null
  const store = getDashboardStore()
  const scope = await resolveScope(did, orgId)
  if (!isScope(scope)) {
    return (
      <PageMain>
        <PageHeader title="API keys" intro="Create, rotate, and revoke the keys apps use to call the BlueyVatar API." />
        <p role="alert">{scope.error}</p>
      </PageMain>
    )
  }
  const license = scope.license
  const org = orgId ? await getOrganization(getPool()!, orgId) : null
  const keys = await store.listKeys(license.licenseId)
  const now = new Date()
  const ent = ENTITLEMENTS[license.tier]
  const active = keys.filter((k) => !k.revokedAt && !isExpired(k.expiresAt, now))
  const activeKeys = active.map((k) => ({ hash: k.hash, kind: k.kind }))
  const canPub = checkKeyLimit(license.tier, 'publishable', activeKeys).ok
  const canSec = checkKeyLimit(license.tier, 'secret', activeKeys).ok
  const reason = license.status !== 'active' ? `This license is ${license.status.replace('_', ' ')}. New keys are disabled.` : !canPub && !canSec ? 'Key limit reached for this tier. Revoke a key to add another.' : null

  return (
    <PageMain>
      <PageHeader title="API keys" intro="Create, rotate, and revoke the keys apps use to call the BlueyVatar API." />
      <SignedInAs did={did} />
      {org && <p>Organization: {org.name}. Every member of this organization can manage its keys. <Link href={`/account/orgs/${org.orgId}`}>Members</Link></p>}

      <p>New to the API? Read the <Link href="/docs">API docs</Link> for parameters, error codes, rate-limit headers, and copy-paste examples, or fetch the <a href="https://img.blueyvatar.com/openapi.json">OpenAPI description</a>.</p>

      <p>Your license, plan limits, and usage are on the <Link href={orgId ? `/account/billing?org=${orgId}` : '/account/billing'}>Plan and billing</Link> page.</p>

      <Section title={`Keys (${active.length}${ent.maxKeys === null ? '' : ` of ${ent.maxKeys}`} active)`}>
      {keys.length === 0 && <p>You have no keys yet. Create a website key below to use BlueyVatar from a web page or app. Server keys are for your own servers.</p>}
      <ul>
        {keys.map((k) => (
          <li key={k.hash} className="mb-4">
            <code>{k.prefix}...</code> {k.kind === 'secret' ? COPY.keys.serverKey : COPY.keys.websiteKey} {k.label ? `"${k.label}"` : ''} created {k.createdAt.toISOString().slice(0, 10)}
            {k.revokedAt ? ` (revoked ${k.revokedAt.toISOString().slice(0, 10)})` : isExpired(k.expiresAt, now) ? ` (Expired ${k.expiresAt!.toISOString().slice(0, 10)})` : k.expiresAt ? `. Expires ${k.expiresAt.toISOString().slice(0, 10)}` : `. Lasts ${COPY.keys.forever}`}
            {k.kind === 'publishable' && !k.revokedAt && !isExpired(k.expiresAt, now) && ent.domainRestrictions && <> Domains: {k.domains.length ? k.domains.join(', ') : 'any host'}</>}
            {!k.revokedAt && !isExpired(k.expiresAt, now) && <KeyActions hash={k.hash} kind={k.kind} domains={k.domains} domainsEnabled={ent.domainRestrictions} orgId={orgId ?? ''} />}
          </li>
        ))}
      </ul>
      <p>Only a SHA256 hash and a short prefix are stored, so a lost key cannot be shown again. Revoke it and create a new one, or rotate it.</p>
      </Section>

      <CreateKeyForm allowSecret={canSec} allowPublishable={canPub} disabledReason={reason} orgId={orgId ?? ''} />
    </PageMain>
  )
}
