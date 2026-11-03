/**
 * Routes a verified custom hostname to /p/{handle} (spec section 11.2, issue #38).
 * Next.js 16 renamed middleware.ts to proxy.ts, and Proxy runs on the Node.js runtime by default,
 * so it can read Postgres directly (docs: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 * Lookups go through a small in-memory TTL cache, including misses.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getDomainStore } from './lib/domain-store'
import { TtlCache } from './lib/host-cache'

const HIT_TTL_MS = 60_000
const MISS_TTL_MS = 15_000
const cache = new TtlCache<string | null>(HIT_TTL_MS)

const appHost = (): string => {
  try {
    return new URL(process.env.PUBLIC_URL ?? 'http://localhost:3000').host.toLowerCase()
  } catch {
    return 'localhost:3000'
  }
}

async function profileFor(host: string): Promise<string | null> {
  const hit = cache.get(host)
  if (hit) return hit.value
  let id: string | null = null
  try {
    id = await getDomainStore().profileFor(host)
  } catch (err) {
    console.error('custom domain lookup failed', err instanceof Error ? err.message : 'unknown')
    return null
  }
  cache.set(host, id, id ? HIT_TTL_MS : MISS_TTL_MS)
  return id
}

export async function proxy(req: NextRequest) {
  const rawHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').toLowerCase()
  const host = rawHost.split(',')[0]!.trim().replace(/:\d+$/, '')
  if (!host || rawHost === appHost() || host === 'localhost') return NextResponse.next()
  const id = await profileFor(host)
  if (!id) return NextResponse.next()
  const { pathname } = req.nextUrl
  if (pathname === '/') return NextResponse.rewrite(new URL(`/p/${encodeURIComponent(id)}`, req.url))
  // Everything else (account, login) lives on the main site.
  return NextResponse.redirect(new URL(`/p/${encodeURIComponent(id)}`, process.env.PUBLIC_URL ?? 'http://localhost:3000'))
}

export const config = {
  matcher: ['/((?!_next/|api/|favicon\\.ico).*)'],
}
