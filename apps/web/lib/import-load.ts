import { isSha256Hex } from '@blueyvatar/core'
import { fetchGravatar, fetchLibravatar, parseImportSource, suggestedRating, type ImportSource } from './import'
import { fetchBlueskyAvatar, repoSession, RepoError } from './repo'
import type { ImageMime } from './records'
import { getStore } from './store'
import type { Rating } from '@blueyvatar/core'

export type Loaded = { source: ImportSource; hash?: string; bytes: Uint8Array; mime: ImageMime; suggested: Rating | null }

/** Parse `bluesky`, `gravatar:{hash}`, or `libravatar:{hash}`. */
export function parseSourceParam(raw: string): { source: ImportSource; hash?: string } | null {
  const [name = '', hash] = raw.split(':')
  const source = parseImportSource(name)
  if (!source) return null
  if (source === 'bluesky') return hash === undefined ? { source } : null
  return hash !== undefined && isSha256Hex(hash) ? { source, hash } : null
}

/** Fetch the image for one source. Email hashes must already be linked to this account. */
export async function loadImport(did: string, raw: string): Promise<Loaded> {
  const parsed = parseSourceParam(raw)
  if (!parsed) throw new RepoError('Unknown import source.')
  if (parsed.source === 'bluesky') {
    const a = await fetchBlueskyAvatar(await repoSession(did))
    return { source: 'bluesky', bytes: a.bytes, mime: a.mime, suggested: suggestedRating('bluesky', a.labels) }
  }
  const links = await getStore().links.list(did)
  if (!links.some((l) => l.emailHash === parsed.hash)) throw new RepoError('That email is not linked to your account.')
  const r = await (parsed.source === 'gravatar' ? fetchGravatar : fetchLibravatar)(parsed.hash!)
  if (!r.ok) throw new RepoError(r.error)
  return { source: parsed.source, hash: parsed.hash, bytes: r.value.bytes, mime: r.value.mime, suggested: null }
}
