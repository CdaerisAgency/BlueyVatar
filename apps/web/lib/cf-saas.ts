/**
 * Cloudflare for SaaS custom hostnames client (spec section 11.2, issue #38).
 * Env: CF_SAAS_ZONE_ID, CF_SAAS_API_TOKEN. When either is unset the feature is "not available yet".
 *
 * Endpoints (zone-scoped), per https://developers.cloudflare.com/api/resources/custom_hostnames/
 *   POST   /zones/{zone_id}/custom_hostnames
 *   GET    /zones/{zone_id}/custom_hostnames/{id}
 *   DELETE /zones/{zone_id}/custom_hostnames/{id}
 *
 * Certificate validation uses ssl.method "txt". The API accepts http, txt, or email
 * (https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/issue-and-validate/validate-certificates/txt/).
 * TXT lets the certificate become active before the customer changes DNS, which avoids the
 * downtime window that automatic HTTP validation can cause. The TXT tokens are not in the
 * create response, so status() is polled
 * (https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/).
 *
 * A hostname is ready when result.status and result.ssl.status are both "active" and the
 * customer's CNAME points at our target (same getting-started page).
 */
export type CfConfig = { zoneId: string; token: string; fetchImpl?: typeof fetch }

export function cfSaasConfig(env: Record<string, string | undefined> = process.env): CfConfig | null {
  const zoneId = env.CF_SAAS_ZONE_ID?.trim()
  const token = env.CF_SAAS_API_TOKEN?.trim()
  return zoneId && token ? { zoneId, token } : null
}

/** The CNAME target customers point at, for example profiles.blueyvatar.com. */
export const fallbackOrigin = (env: Record<string, string | undefined> = process.env): string | null => env.CF_SAAS_FALLBACK_ORIGIN?.trim() || null

export type DomainStatus = 'pending' | 'active' | 'failed'
export type DnsRecord = { type: 'TXT'; name: string; value: string; purpose: 'hostname' | 'certificate' }

export type HostnameState = {
  id: string
  hostname: string
  status: DomainStatus
  /** TXT records the customer must add, from ownership_verification and ssl.validation_records. */
  records: DnsRecord[]
  errors: string[]
}

type CfHostname = {
  id?: string
  hostname?: string
  status?: string
  verification_errors?: string[]
  ownership_verification?: { name?: string; type?: string; value?: string }
  ssl?: {
    status?: string
    validation_errors?: { message?: string }[]
    validation_records?: { txt_name?: string; txt_value?: string }[]
  }
}

// Hostname statuses and certificate statuses that will not resolve without a change.
// https://developers.cloudflare.com/api/resources/custom_hostnames/ (status enums)
const FAILED_HOST = new Set(['blocked', 'test_failed', 'test_blocked', 'deleted', 'moved'])
const FAILED_SSL = new Set(['validation_timed_out', 'issuance_timed_out', 'deployment_timed_out', 'deleted', 'expired'])

/** Map a Cloudflare custom hostname object to our summary. Pure, so it is unit tested. */
export function mapHostname(r: CfHostname): HostnameState {
  const hostStatus = r.status ?? 'pending'
  const sslStatus = r.ssl?.status ?? 'initializing'
  const records: DnsRecord[] = []
  const ov = r.ownership_verification
  if (ov?.name && ov.value) records.push({ type: 'TXT', name: ov.name, value: ov.value, purpose: 'hostname' })
  for (const v of r.ssl?.validation_records ?? []) {
    if (v.txt_name && v.txt_value) records.push({ type: 'TXT', name: v.txt_name, value: v.txt_value, purpose: 'certificate' })
  }
  const errors = [...(r.verification_errors ?? []), ...(r.ssl?.validation_errors ?? []).flatMap((e) => (e.message ? [e.message] : []))]
  const status: DomainStatus =
    hostStatus === 'active' && sslStatus === 'active' ? 'active' : FAILED_HOST.has(hostStatus) || FAILED_SSL.has(sslStatus) ? 'failed' : 'pending'
  return { id: r.id ?? '', hostname: r.hostname ?? '', status, records, errors }
}

export class CfError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message)
  }
}

async function call(cfg: CfConfig, method: string, path: string, body?: unknown): Promise<CfHostname | null> {
  const res = await (cfg.fetchImpl ?? fetch)(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.zoneId)}/custom_hostnames${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  })
  let json: { success?: boolean; errors?: { message?: string }[]; result?: CfHostname | null } = {}
  try {
    json = await res.json()
  } catch {
    // non-JSON error body
  }
  if (!res.ok || json.success === false) {
    throw new CfError(json.errors?.map((e) => e.message).filter(Boolean).join('; ') || `Cloudflare returned HTTP ${res.status}.`, res.status)
  }
  return json.result ?? null
}

/** Create a custom hostname with TXT certificate validation. Tokens arrive on a later status() call. */
export async function createHostname(cfg: CfConfig, hostname: string): Promise<HostnameState> {
  const r = await call(cfg, 'POST', '', {
    hostname,
    ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
  })
  if (!r) throw new CfError('Cloudflare returned no result.', 502)
  return mapHostname(r)
}

export async function getHostname(cfg: CfConfig, id: string): Promise<HostnameState> {
  const r = await call(cfg, 'GET', `/${encodeURIComponent(id)}`)
  if (!r) throw new CfError('Cloudflare returned no result.', 502)
  return mapHostname(r)
}

/** Delete a custom hostname. A hostname that is already gone counts as deleted. */
export async function deleteHostname(cfg: CfConfig, id: string): Promise<void> {
  try {
    await call(cfg, 'DELETE', `/${encodeURIComponent(id)}`)
  } catch (err) {
    if (err instanceof CfError && err.httpStatus === 404) return
    throw err
  }
}
