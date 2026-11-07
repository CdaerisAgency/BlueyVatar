/**
 * Purges cached `/img/{did}/{cid}/` prefixes from Cloudflare after an account's data is deleted (issue #140).
 * Same zone and token as the indexer (`CF_ZONE_ID`, `CF_API_TOKEN`). Prefix mode needs no signing secret and covers every
 * variant of a CID. Cloudflare takes up to 30 prefixes per request: https://developers.cloudflare.com/api/resources/cache/methods/purge/
 * Returns false, without throwing, when it is not configured or Cloudflare refuses, so deletion never fails on a cache.
 */
const PER_REQUEST = 30

export async function purgeImagePrefixes(did: string, cids: string[], env: Record<string, string | undefined> = process.env, doFetch: typeof fetch = fetch): Promise<boolean> {
  const zone = env.CF_ZONE_ID?.trim()
  const token = env.CF_API_TOKEN?.trim()
  const origin = env.PUBLIC_DELIVERY_URL?.trim() || env.DELIVERY_URL?.trim()
  if (!zone || !token || !origin || cids.length === 0) return false
  const host = origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
  let ok = true
  for (let i = 0; i < cids.length; i += PER_REQUEST) {
    const prefixes = cids.slice(i, i + PER_REQUEST).map((cid) => `${host}/img/${encodeURIComponent(did)}/${cid}/`)
    try {
      const res = await doFetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes }),
      })
      if (!res.ok) ok = false
    } catch {
      ok = false
    }
  }
  if (!ok) console.error('cache purge after account deletion failed', { did })
  return ok
}
