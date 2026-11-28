export type Purge = (did: string, cids: string[]) => Promise<boolean>

/**
 * Purges cached `/img/{did}/{cid}/` prefixes from Cloudflare, the same mode the ops CLI uses. Returns false when
 * the settings are missing or the call failed, so the admin page can say the cache purge still needs doing. Never throws.
 */
export function purgerFromEnv(env: Record<string, string | undefined> = process.env, doFetch: typeof fetch = fetch): Purge {
  return async (did, cids) => {
    const { CF_ZONE_ID: zone, CF_API_TOKEN: token, PUBLIC_DELIVERY_URL: base } = env
    if (!zone || !token || !base) return false
    const host = base.replace(/\/$/, '').replace(/^https?:\/\//, '')
    const prefixes = cids.map((cid) => `${host}/img/${encodeURIComponent(did)}/${cid}/`)
    try {
      for (let i = 0; i < prefixes.length; i += 100) {
        const res = await doFetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ prefixes: prefixes.slice(i, i + 100) }),
        })
        if (!res.ok) return false
      }
      return true
    } catch (err) {
      console.error('admin purge failed', err instanceof Error ? err.name : 'unknown')
      return false
    }
  }
}
