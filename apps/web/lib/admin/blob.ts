import { parseSafeHttpsUrl } from '@blueyvatar/core'

const MAX_BYTES = 12 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** The atproto PDS endpoint from a DID document, or null. Only public https origins are accepted. */
export function pdsFromDidDoc(doc: unknown): string | null {
  const services = (doc as { service?: { id?: string; type?: string; serviceEndpoint?: unknown }[] } | null)?.service
  const s = services?.find((x) => x.id === '#atproto_pds' || x.type === 'AtprotoPersonalDataServer')
  if (typeof s?.serviceEndpoint !== 'string') return null
  const u = parseSafeHttpsUrl(s.serviceEndpoint)
  return u ? u.origin : null
}

async function didDoc(did: string, doFetch: typeof fetch): Promise<unknown> {
  const url = did.startsWith('did:web:') ? `https://${decodeURIComponent(did.slice(8).split(':')[0] ?? '')}/.well-known/did.json` : `https://plc.directory/${encodeURIComponent(did)}`
  if (!parseSafeHttpsUrl(url)) return null
  const res = await doFetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' })
  return res.ok ? res.json() : null
}

export type ReviewBlob = { bytes: Uint8Array; type: string }

/**
 * Fetches an image from the account's own PDS (com.atproto.sync.getBlob) for the reviewer. Used because blocked images are no
 * longer served by delivery. Returns null on any failure, an unexpected type, or a body over the size cap. Never throws.
 */
export async function fetchReviewBlob(did: string, cid: string, doFetch: typeof fetch = fetch): Promise<ReviewBlob | null> {
  try {
    const pds = pdsFromDidDoc(await didDoc(did, doFetch))
    if (!pds) return null
    const res = await doFetch(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`, { signal: AbortSignal.timeout(15000), redirect: 'error' })
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!res.ok || !IMAGE_TYPES.has(type)) return null
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_BYTES) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    return bytes.byteLength <= MAX_BYTES ? { bytes, type } : null
  } catch {
    return null
  }
}
