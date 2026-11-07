// Post-deploy smoke test (issue #148, handoff step 7). It drives the deployed apps over HTTPS, the way a
// visitor or a CDN would, and exits 1 when any check fails.
//
//   pnpm smoke -- --env staging|production
//
// Optional settings (environment variables):
//   SMOKE_WEB_URL, SMOKE_DELIVERY_URL, SMOKE_ORIGIN_URL  override the URLs for the chosen environment
//   SMOKE_ORIGIN_SECRET   sent as x-origin-auth on delivery checks that go through the public URL. Needed
//                         only when that URL is the Fly hostname itself (staging has no Cloudflare). It is
//                         never sent on the direct-origin lockdown check.
//   SMOKE_HANDLE          handle of an account with an avatar and a profile. Enables the /p/{handle} and
//                         cache MISS to HIT checks. Without it those checks are skipped, not failed.
//   SMOKE_OPTED_OUT_HASH  SHA256 of an email whose owner opted out of lookup. Without it the unlinked-hash
//                         check compares two random unlinked hashes with each other.
import { createHash, randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export type EnvName = 'staging' | 'production'
export interface Targets { web: string; delivery: string; origin: string }
export interface Options { handle?: string; originSecret?: string; optedOutHash?: string; fetchImpl?: typeof fetch; wait?: (ms: number) => Promise<void> }
export type Outcome = { name: string; status: 'pass' | 'fail' | 'skip'; detail: string }

export const DEFAULT_TARGETS: Record<EnvName, Targets> = {
  production: { web: 'https://blueyvatar.com', delivery: 'https://img.blueyvatar.com', origin: 'https://blueyvatar-delivery.fly.dev' },
  staging: {
    web: 'https://blueyvatar-web-staging.fly.dev',
    delivery: 'https://blueyvatar-delivery-staging.fly.dev',
    origin: 'https://blueyvatar-delivery-staging.fly.dev',
  },
}

const trim = (u: string) => u.replace(/\/+$/, '')

export function targetsFor(env: EnvName, vars: Record<string, string | undefined> = process.env): Targets {
  const d = DEFAULT_TARGETS[env]
  return {
    web: trim(vars.SMOKE_WEB_URL || d.web),
    delivery: trim(vars.SMOKE_DELIVERY_URL || d.delivery),
    origin: trim(vars.SMOKE_ORIGIN_URL || d.origin),
  }
}

/** Reads `--env staging|production`. A bare `--` (what `pnpm smoke -- ...` forwards) is ignored. */
export function parseArgs(argv: string[]): EnvName {
  const args = argv.filter((a) => a !== '--')
  const i = args.indexOf('--env')
  const v = i >= 0 ? args[i + 1] : args.find((a) => a.startsWith('--env='))?.slice(6)
  if (v !== 'staging' && v !== 'production') throw new Error('Usage: pnpm smoke -- --env staging|production')
  return v
}

/** Headers that legitimately differ between two otherwise identical responses. */
const VOLATILE = new Set(['date', 'x-request-id', 'cf-ray', 'cf-cache-status', 'age', 'report-to', 'nel', 'server-timing', 'alt-svc', 'fly-request-id', 'server', 'x-rate-limit-remaining', 'x-rate-limit-reset'])

/** Status plus headers, with the looked-up hash masked, so two misses for different hashes compare equal. */
export function fingerprint(res: Response, hash: string): string {
  const rows = [...res.headers].filter(([k]) => !VOLATILE.has(k.toLowerCase())).map(([k, v]) => `${k.toLowerCase()}: ${v.split(hash).join('{hash}')}`).sort()
  return [`status ${res.status}`, ...rows].join('\n')
}

class Fail extends Error {}
const must = (ok: boolean, msg: string) => {
  if (!ok) throw new Fail(msg)
}

export async function runSmoke(t: Targets, o: Options = {}): Promise<Outcome[]> {
  const f = o.fetchImpl ?? fetch
  const wait = o.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const edge: Record<string, string> = o.originSecret ? { 'x-origin-auth': o.originSecret } : {}
  const get = (url: string, init: RequestInit = {}) =>
    f(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...init, headers: { 'user-agent': 'blueyvatar-smoke', ...(init.headers as object) } })
  const out: Outcome[] = []
  const check = async (name: string, fn: () => Promise<string | void>) => {
    try {
      out.push({ name, status: 'pass', detail: (await fn()) ?? 'ok' })
    } catch (err) {
      out.push({ name, status: 'fail', detail: err instanceof Error ? err.message : String(err) })
    }
  }
  const skip = (name: string, why: string) => out.push({ name, status: 'skip', detail: why })

  await check('delivery /healthz returns 200', async () => {
    const r = await get(`${t.delivery}/healthz`)
    must(r.status === 200, `got ${r.status}`)
  })

  await check('direct Fly hostname refuses with 403 origin_forbidden', async () => {
    const r = await get(`${t.origin}/u/x`)
    const body = await r.text()
    must(r.status === 403, `got ${r.status}, expected 403`)
    must(body.includes('origin_forbidden'), 'body does not carry origin_forbidden')
  })

  await check('unlinked hash answers like an opted-out hash', async () => {
    const hashA = createHash('sha256').update(randomBytes(16)).digest('hex')
    const hashB = o.optedOutHash ?? createHash('sha256').update(randomBytes(16)).digest('hex')
    const a = await get(`${t.delivery}/avatar/${hashA}`, { headers: edge })
    const b = await get(`${t.delivery}/avatar/${hashB}`, { headers: edge })
    must(a.status === 302, `unlinked hash answered ${a.status}, expected the default redirect (302)`)
    must(String(a.headers.get('location')).includes('/default/'), 'unlinked hash did not redirect to a default image')
    // The hashes differ, so each is masked in its own response before comparing.
    const fa = fingerprint(a, hashA)
    const fb = fingerprint(b, hashB)
    must(fa === fb, `responses differ:\n--- unlinked\n${fa}\n--- ${o.optedOutHash ? 'opted out' : 'second unlinked'}\n${fb}`)
    return o.optedOutHash ? 'compared with the opted-out hash' : 'compared two random unlinked hashes (set SMOKE_OPTED_OUT_HASH for a true opt-out)'
  })

  const handle = o.handle
  if (handle) {
    await check('/img cache status moves from MISS to HIT', async () => {
      const first = await get(`${t.delivery}/u/${encodeURIComponent(handle)}`, { headers: edge })
      const loc = first.headers.get('location')
      must(first.status === 302 && !!loc && loc.startsWith('/img/'), `/u/${handle} did not redirect to a signed /img path (status ${first.status}, location ${loc})`)
      const url = `${t.delivery}${loc}`
      const r1 = await get(url, { headers: edge })
      must(r1.status === 200, `first /img fetch got ${r1.status}`)
      await r1.arrayBuffer()
      await wait(2000)
      const r2 = await get(url, { headers: edge })
      must(r2.status === 200, `second /img fetch got ${r2.status}`)
      await r2.arrayBuffer()
      const s1 = (r1.headers.get('cf-cache-status') ?? 'none').toUpperCase()
      const s2 = (r2.headers.get('cf-cache-status') ?? 'none').toUpperCase()
      must(['MISS', 'HIT', 'EXPIRED', 'REVALIDATED'].includes(s1), `first cf-cache-status was ${s1}`)
      must(s2 === 'HIT', `second cf-cache-status was ${s2}, expected HIT (first was ${s1})`)
      return `${s1} then ${s2}`
    })
    await check('/p/{handle} renders', async () => {
      const r = await get(`${t.web}/p/${encodeURIComponent(handle)}`)
      const html = await r.text()
      must(r.status === 200, `got ${r.status}`)
      must(/<h1[ >]/.test(html) && !html.includes('Profile not found'), 'page has no profile heading')
    })
  } else {
    skip('/img cache status moves from MISS to HIT', 'SMOKE_HANDLE is not set')
    skip('/p/{handle} renders', 'SMOKE_HANDLE is not set')
  }

  await check('/oauth-client-metadata.json responds', async () => {
    const r = await get(`${t.web}/oauth-client-metadata.json`)
    must(r.status === 200, `got ${r.status}`)
    const j = (await r.json()) as { client_id?: unknown; redirect_uris?: unknown }
    must(typeof j.client_id === 'string' && Array.isArray(j.redirect_uris), 'missing client_id or redirect_uris')
  })

  await check('/oauth/jwks.json responds', async () => {
    const r = await get(`${t.web}/oauth/jwks.json`)
    must(r.status === 200, `got ${r.status}`)
    const j = (await r.json()) as { keys?: unknown }
    must(Array.isArray(j.keys) && j.keys.length > 0, 'no keys')
    must(!JSON.stringify(j).includes('"d"'), 'JWKS exposes a private member')
  })

  await check('/api/stripe/webhook rejects an unsigned body', async () => {
    const r = await get(`${t.web}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"checkout.session.completed"}' })
    must(r.status === 400, `got ${r.status}, expected 400 (503 means the webhook secret is not configured)`)
  })

  return out
}

export function report(rows: Outcome[], log: (s: string) => void = console.log): boolean {
  for (const r of rows) {
    const tag = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'SKIP'
    log(`${tag}  ${r.name}${r.detail && r.detail !== 'ok' ? `\n      ${r.detail.split('\n').join('\n      ')}` : ''}`)
  }
  const n = (s: Outcome['status']) => rows.filter((r) => r.status === s).length
  log(`${n('pass')} passed, ${n('fail')} failed, ${n('skip')} skipped`)
  return n('fail') === 0
}

async function main() {
  const env = parseArgs(process.argv.slice(2))
  const t = targetsFor(env)
  console.log(`Smoke test: ${env} (web ${t.web}, delivery ${t.delivery}, origin ${t.origin})`)
  const rows = await runSmoke(t, {
    handle: process.env.SMOKE_HANDLE || undefined,
    originSecret: process.env.SMOKE_ORIGIN_SECRET || undefined,
    optedOutHash: process.env.SMOKE_OPTED_OUT_HASH || undefined,
  })
  process.exit(report(rows) ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
