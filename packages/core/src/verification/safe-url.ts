/**
 * URL safety for fetching user-supplied pages (verification, spec section 8).
 * Pure checks live here; safe-fetch.ts does the network call with these guards applied.
 */
import { isIP } from 'node:net'

const v4 = (ip: string): [number, number, number, number] => ip.split('.').map(Number) as [number, number, number, number]

function privateV4(ip: string): boolean {
  const [a, b, c] = v4(ip)
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

/** Expands an IPv6 address to eight 16-bit groups, or null when it is malformed. */
export function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (dotted) {
    const d4 = dotted[1]!
    if (isIP(d4) !== 4) return null
    const [a, b, c, d] = v4(d4)
    s = s.slice(0, -d4.length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail].map((g) => parseInt(g, 16))
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null
}

/** True for loopback, private, link-local, reserved, multicast, and unparseable addresses. */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return privateV4(ip)
  if (kind !== 6) return true
  const g = expandV6(ip) as number[] | null
  if (!g) return true
  const [g0, g1, g2, g5, g6, g7] = [g[0]!, g[1]!, g[2]!, g[5]!, g[6]!, g[7]!]
  const embedded = (hi: number, lo: number) => privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  if (g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g7 === 1)) return true // :: and ::1
  if (g.slice(0, 5).every((x) => x === 0) && (g5 === 0xffff || g5 === 0)) return embedded(g6, g7) // mapped and compatible
  if (g0 === 0x64 && g1 === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g6, g7) // NAT64
  if (g0 === 0x2002) return embedded(g1, g2) // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return true // unique local
  if ((g0 & 0xffc0) === 0xfe80) return true // link-local
  if ((g0 & 0xff00) === 0xff00) return true // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true // documentation
  return false
}

const LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.arpa']

/** A DNS name that can plausibly be public. IP literals and local-only names are refused. */
export function isPublicHostname(raw: string): boolean {
  const host = raw.toLowerCase().replace(/\.$/, '')
  if (!host || host.length > 253 || host === 'localhost') return false
  if (isIP(host) !== 0 || host.startsWith('[')) return false
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false
  const labels = host.split('.')
  if (labels.length < 2) return false
  if (!labels.every((l) => LABEL.test(l))) return false
  return /[a-z]/.test(labels[labels.length - 1]!)
}

/** https only, no credentials, default port, public hostname. Returns the parsed URL or null. */
export function parseSafeHttpsUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  return isPublicHostname(u.hostname) ? u : null
}
