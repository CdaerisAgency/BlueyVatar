/**
 * Target guard (issue #149). The load generator only talks to loopback or a staging host.
 * Anything else, production included, needs an explicit --i-know. Production hosts are
 * refused even with a staging-looking name when they are the apex or a known prod label.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
// A label that is exactly "staging" or starts/ends with it, such as staging.example.com or blueyvatar-staging.fly.dev.
const STAGING = /(^|[.-])staging([.-]|$)/i

/** @returns {{ allowed: boolean, kind: 'loopback' | 'staging' | 'other', host: string }} */
export function classifyTarget(urlString) {
  const host = new URL(urlString).hostname.toLowerCase()
  if (LOOPBACK.has(host) || /^127\./.test(host)) return { allowed: true, kind: 'loopback', host }
  if (STAGING.test(host)) return { allowed: true, kind: 'staging', host }
  return { allowed: false, kind: 'other', host }
}

/** Throws unless the target is loopback or staging, or the caller passed --i-know. */
export function assertTargetAllowed(urlString, iKnow = false) {
  const c = classifyTarget(urlString)
  if (!c.allowed && !iKnow) {
    throw new Error(
      `Refusing to load test ${c.host}: it is not loopback or a staging host. ` +
      'Point --base at a staging deployment, or pass --i-know if you are certain this host may take synthetic load.',
    )
  }
  return c
}

/** Database guard for the seed script: loopback or a host that names staging. */
export function assertDatabaseAllowed(connectionString, iKnow = false) {
  const host = new URL(connectionString).hostname.toLowerCase()
  const ok = LOOPBACK.has(host) || /^127\./.test(host) || STAGING.test(host) || host === ''
  if (!ok && !iKnow) {
    throw new Error(`Refusing to seed ${host}: not loopback and the host name does not contain "staging". Pass --i-know to override.`)
  }
  return host
}
