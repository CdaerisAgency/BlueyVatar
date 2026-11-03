import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import type { IncomingHttpHeaders } from 'node:http'
import { request } from 'node:https'
import { isPrivateIp, parseSafeHttpsUrl } from './safe-url'

export class SafeFetchError extends Error {}

export type Resolver = (hostname: string, cb: (err: Error | null, addresses: LookupAddress[]) => void) => void

const systemResolver: Resolver = (hostname, cb) => dnsLookup(hostname, { all: true, verbatim: true }, cb)

type LookupCb = (err: Error | null, address?: string | LookupAddress[], family?: number) => void

/**
 * A dns.lookup replacement for https.request. The address that was checked is the address
 * the socket connects to, so DNS rebinding cannot swap in a private address afterward.
 */
export function guardedLookup(resolve: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean }, cb: LookupCb): void => {
    resolve(hostname, (err, addrs) => {
      if (err) return cb(err)
      if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
        return cb(new SafeFetchError('That host resolves to a private or unusable address.'))
      }
      if (options?.all) return cb(null, addrs)
      cb(null, addrs[0]!.address, addrs[0]!.family)
    })
  }
}

export type SafeFetchOptions = {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  resolver?: Resolver
}
export type SafeFetchResult = { status: number; url: string; text: string; headers: IncomingHttpHeaders }
export type Fetcher = (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResult>

function once(url: URL, o: SafeFetchOptions): Promise<{ status: number; headers: IncomingHttpHeaders; text: string }> {
  const max = o.maxBytes ?? 1_000_000
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: o.method ?? 'GET',
        headers: { 'user-agent': 'blueyvatar-verifier/1.0 (+https://blueyvatar.com)', accept: 'text/html,application/json;q=0.9,*/*;q=0.1', ...o.headers },
        lookup: guardedLookup(o.resolver) as never,
        signal: AbortSignal.timeout(o.timeoutMs ?? 8000),
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > max) {
            res.destroy()
            reject(new SafeFetchError('The page is too large.'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      },
    )
    req.on('error', (e) => reject(e instanceof SafeFetchError ? e : new SafeFetchError(e.name === 'AbortError' ? 'The page took too long to respond.' : 'The page could not be fetched.')))
    if (o.body !== undefined) req.write(o.body)
    req.end()
  })
}

/**
 * Fetches a user-supplied https URL. Every hop (including redirects, followed for GET only)
 * must be a public https host, every connection is address-checked, and time and size are capped.
 */
export const safeFetch: Fetcher = async (rawUrl, o = {}) => {
  let current = rawUrl
  for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
    const url = parseSafeHttpsUrl(current)
    if (!url) throw new SafeFetchError('Only public https addresses can be checked.')
    const r = await once(url, o)
    const loc = r.headers.location
    if (r.status >= 300 && r.status < 400 && loc) {
      if ((o.method ?? 'GET') !== 'GET') throw new SafeFetchError('Unexpected redirect.')
      current = new URL(loc, url).href
      continue
    }
    return { status: r.status, url: url.href, text: r.text, headers: r.headers }
  }
  throw new SafeFetchError('Too many redirects.')
}
