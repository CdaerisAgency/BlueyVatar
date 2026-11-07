import { PageMain, TableBox } from '../../../components/Page'
import { ENTITLEMENTS, TIERS, type Tier } from '@blueyvatar/core'
import { ATTRIBUTION_SNIPPET } from '@blueyvatar/core/verification'
import Link from 'next/link'
import { COPY } from '../../../lib/copy'
import { requireDid } from '../../../lib/auth'
import { getDashboardStore } from '../../../lib/dashboard-store'
import { alertState, checkKeyLimit, historyPeriods, includedVolume, periodStartOf } from '../../../lib/keys'
import AccountNav from '../AccountNav'
import { CreateKeyForm, KeyActions } from './KeyControls'

export const dynamic = 'force-dynamic'

const n = (v: number | null) => (v === null ? 'Custom' : v.toLocaleString('en-US'))
const ALERT_TEXT = { ok: 'Below 80 percent of included volume.', warn80: 'At or above 80 percent of included volume.', over100: 'Included volume reached.', 'n/a': 'No monthly alert for this tier.' }

export default async function KeysPage() {
  const did = await requireDid('/account/keys')
  const store = getDashboardStore()
  const license = await store.ensureLicense(did)
  const keys = await store.listKeys(license.licenseId)
  const now = new Date()
  const period = periodStartOf(now)
  const periods = historyPeriods(license.tier, now)
  const usage = await store.usage(license.licenseId, [period, ...periods])
  const sent = await store.alertsSent(license.licenseId, period)
  const ent = ENTITLEMENTS[license.tier]
  const inc = includedVolume(license.tier)
  const used = usage.get(`${period}|origin_resolution`) ?? 0
  const active = keys.filter((k) => !k.revokedAt)
  const activeKeys = active.map((k) => ({ hash: k.hash, kind: k.kind }))
  const canPub = checkKeyLimit(license.tier, 'publishable', activeKeys).ok
  const canSec = checkKeyLimit(license.tier, 'secret', activeKeys).ok
  const state = alertState(license.tier, used)
  const reason = license.status !== 'active' ? `This license is ${license.status.replace('_', ' ')}. New keys are disabled.` : !canPub && !canSec ? 'Key limit reached for this tier. Revoke a key to add another.' : null

  return (
    <PageMain>
      <AccountNav />
      <h1>License and API keys</h1>
      <p>Signed in as {did}</p>

      <h2>License</h2>
      <ul>
        <li>Tier: {license.tier}</li>
        <li>Status: {license.status.replace('_', ' ')}</li>
        <li>Term: {license.term}</li>
        <li>
          Included volume: {inc.volume === null ? 'Custom' : `${n(inc.volume)} keyed requests per ${inc.per}`}
        </li>
        <li>
          Usage this period ({period}): {n(used)} origin resolutions
          {inc.per === 'month' && inc.volume ? ` of ${n(inc.volume)} (${Math.round((used / inc.volume) * 100)} percent)` : ''}
        </li>
        <li>
          Alerts: {ALERT_TEXT[state]} {sent.length > 0 ? `Sent this period: ${sent.map((t) => `${t} percent`).join(', ')}.` : 'None sent this period.'}
        </li>
        {inc.per === 'day' && <li>Free limits are per day, so the monthly total above is for reference.</li>}
      </ul>
      <p>Change your plan on the <Link href="/account/billing">Billing</Link> page. The table below shows what each tier includes.</p>

      {periods.length > 0 && (
        <>
          <h2>Usage history</h2>
          <TableBox label="Usage history">
          <table>
            <thead>
              <tr>
                <th align="left">Month</th>
                <th align="right">Origin resolutions</th>
                <th align="right">Profile JSON calls</th>
                <th align="right">Transforms</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p}>
                  <td>{p.slice(0, 7)}</td>
                  <td align="right">{n(usage.get(`${p}|origin_resolution`) ?? 0)}</td>
                  <td align="right">{n(usage.get(`${p}|profile_json`) ?? 0)}</td>
                  <td align="right">{n(usage.get(`${p}|transform`) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableBox>
          <p>{license.tier === 'pro' ? 'Pro shows 30 days of history.' : 'Shows up to 12 months of history.'}</p>
        </>
      )}

      <h2>{COPY.attribution.title}</h2>
      {ent.attributionRequired ? (
        <section>
          <p>{COPY.attribution.why}</p>
          <p>{COPY.attribution.how}</p>
          <p id="attribution-snippet-label">{COPY.attribution.snippetLabel}</p>
          <pre tabIndex={0} aria-labelledby="attribution-snippet-label">
            <code>{ATTRIBUTION_SNIPPET}</code>
          </pre>
          <p>
            {COPY.attribution.note} See <Link href="/policy#attribution">what counts</Link>.
          </p>
        </section>
      ) : (
        <p>{COPY.attribution.paid}</p>
      )}

      <h2>Keys ({active.length}{ent.maxKeys === null ? '' : ` of ${ent.maxKeys}`} active)</h2>
      {keys.length === 0 && <p>You have no keys yet. Create a publishable key below to use blueyvatar from a website or app. Secret keys are for servers.</p>}
      <ul>
        {keys.map((k) => (
          <li key={k.hash} className="mb-4">
            <code>{k.prefix}...</code> {k.kind} {k.label ? `"${k.label}"` : ''} created {k.createdAt.toISOString().slice(0, 10)}
            {k.revokedAt ? ` (revoked ${k.revokedAt.toISOString().slice(0, 10)})` : ''}
            {k.kind === 'publishable' && !k.revokedAt && ent.domainRestrictions && <> Domains: {k.domains.length ? k.domains.join(', ') : 'any host'}</>}
            {k.kind === 'publishable' && !k.revokedAt && ent.attributionRequired && (
              <p>
                Attribution site: {k.attributionSite ?? COPY.attribution.siteNone}
                {k.attributionSite && (
                  <>
                    {' '}
                    {COPY.attribution.results[k.attributionResult ?? 'pending']}
                    {k.attributionCheckedAt ? ` Last checked ${k.attributionCheckedAt.toISOString().slice(0, 10)}.` : ''}
                  </>
                )}
              </p>
            )}
            {!k.revokedAt && (
              <KeyActions
                hash={k.hash}
                kind={k.kind}
                domains={k.domains}
                domainsEnabled={ent.domainRestrictions}
                attribution={ent.attributionRequired ? { site: k.attributionSite } : undefined}
              />
            )}
          </li>
        ))}
      </ul>
      <p>Only a SHA256 hash and a short prefix are stored, so a lost key cannot be shown again. Rotate it instead.</p>

      <CreateKeyForm allowSecret={canSec} allowPublishable={canPub} disabledReason={reason} />

      <h2>Tiers</h2>
      <TableBox label="Tiers">
      <table>
        <thead>
          <tr>
            <th align="left">Capability</th>
            {TIERS.map((t: Tier) => (
              <th key={t} align="left">{t}{t === license.tier ? ' (yours)' : ''}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['Keyed volume', (e) => (e.keyedDaily ? `${n(e.keyedDaily)} per day` : e.keyedMonthly ? `${n(e.keyedMonthly)} per month` : 'Custom')],
              ['API keys', (e) => (e.maxKeys === null ? 'Unlimited' : String(e.maxKeys))],
              ['Domain restrictions', (e) => (e.domainRestrictions ? 'Yes' : 'No')],
              ['Overage', (e) => e.overage],
              ['Max size', (e) => String(e.maxSize)],
              ['Formats', (e) => e.formats.join(', ')],
              ['Attribution required', (e) => (e.attributionRequired ? 'Yes' : 'No')],
              ['Hovercards', (e) => (e.hovercards ? 'Yes' : 'No')],
            ] as [string, (e: (typeof ENTITLEMENTS)[Tier]) => string][]
          ).map(([label, f]) => (
            <tr key={label}>
              <td>{label}</td>
              {TIERS.map((t) => (
                <td key={t}>{f(ENTITLEMENTS[t])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </TableBox>
    </PageMain>
  )
}
