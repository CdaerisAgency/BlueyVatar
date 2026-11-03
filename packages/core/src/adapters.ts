/**
 * Profile source adapters (spec section 7). An adapter is configuration that
 * says where one atproto app keeps its avatar, so a new app needs no new code.
 */
export interface ProfileAdapter {
  id: string
  collection: string
  rkey: string
  avatarPath: string
  labelsPath: string
  accept: readonly string[]
  priority: number
  enabled: boolean
}

export const BLUESKY_PROFILE_ADAPTER: ProfileAdapter = {
  id: 'bluesky',
  collection: 'app.bsky.actor.profile',
  rkey: 'self',
  avatarPath: 'avatar',
  labelsPath: 'labels',
  accept: ['image/png', 'image/jpeg'],
  priority: 1,
  enabled: true,
}

/**
 * Tangled profile adapters. The avatar field is `avatar` (PNG or JPEG, up to
 * 1,000,000 bytes) in both collections. Tangled replaced sh.tangled.actor.profile
 * with org.tangled.actor.profile on Nov 2, 2026, and whether existing records
 * moved is unconfirmed (spec v6, section 13). Both ship disabled until checked
 * against live repos, since each enabled adapter adds a PDS read per miss.
 */
export const TANGLED_PROFILE_ADAPTER: ProfileAdapter = {
  id: 'tangled',
  collection: 'org.tangled.actor.profile',
  rkey: 'self',
  avatarPath: 'avatar',
  labelsPath: 'labels',
  accept: ['image/png', 'image/jpeg'],
  priority: 2,
  enabled: false,
}

export const TANGLED_LEGACY_PROFILE_ADAPTER: ProfileAdapter = {
  ...TANGLED_PROFILE_ADAPTER,
  id: 'tangled-legacy',
  collection: 'sh.tangled.actor.profile',
  priority: 3,
}

export const DEFAULT_ADAPTERS: readonly ProfileAdapter[] = [
  BLUESKY_PROFILE_ADAPTER,
  TANGLED_PROFILE_ADAPTER,
  TANGLED_LEGACY_PROFILE_ADAPTER,
]

export function activeAdapters(list: readonly ProfileAdapter[]): ProfileAdapter[] {
  return list.filter((a) => a.enabled).sort((a, b) => a.priority - b.priority)
}

/** Read a dotted path from a record value. */
export function getPath(record: unknown, path: string): unknown {
  let cur: unknown = record
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/** Extract self-label values from a com.atproto.label.defs#selfLabels object. */
export function selfLabelValues(labels: unknown): string[] {
  const values = getPath(labels, 'values')
  if (!Array.isArray(values)) return []
  return values
    .map((v) => (v && typeof v === 'object' ? (v as { val?: unknown }).val : undefined))
    .filter((v): v is string => typeof v === 'string')
}

export interface BlobRef {
  cid: string
  mimeType: string
  size?: number
}

/** Accepts the current typed blob ref and the legacy {cid, mimeType} form. */
export function readBlobRef(value: unknown): BlobRef | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const mimeType = typeof v.mimeType === 'string' ? v.mimeType : null
  if (!mimeType) return null
  const ref = v.ref
  let cid: string | null = null
  if (typeof v.cid === 'string') cid = v.cid
  else if (ref && typeof ref === 'object' && typeof (ref as { $link?: unknown }).$link === 'string') {
    cid = (ref as { $link: string }).$link
  } else if (ref && typeof (ref as { toString?: unknown }).toString === 'function') {
    const s = String(ref)
    if (s && s !== '[object Object]') cid = s
  }
  if (!cid) return null
  return { cid, mimeType, size: typeof v.size === 'number' ? v.size : undefined }
}
