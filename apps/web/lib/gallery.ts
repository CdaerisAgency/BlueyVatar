/**
 * Gallery images for Plus users: pure validation plus the repository operations behind the
 * account page's Gallery section. Every record written here has purpose `gallery`, never sets
 * isDefault, and never touches the profile's defaultImage, so a gallery image cannot become the avatar.
 */
import type { OAuthSession } from '@atproto/oauth-client-node'
import { GALLERY_CAPTION_MAX, GALLERY_MAX } from '@blueyvatar/core'
import { resolvePlan } from './plan'
import { RepoError, createImage, listGalleryRecords, uploadBlob, xrpc, type ImageRecord, type StoredImage } from './repo'
import {
  IMAGE_COLLECTION,
  graphemeCount,
  validateImageBytes,
  validateNewImage,
  type Check,
  type ImageMime,
  type NewImageFields,
  type NewImageInput,
} from './records'

export const GALLERY_PLUS_MESSAGE = 'Gallery images are part of the Plus plan.'
export const galleryFullMessage = `The gallery holds up to ${GALLERY_MAX} images. Delete one to add another.`
export const GALLERY_RKEY_PATTERN = /^[A-Za-z0-9._~:-]{1,512}$/

export const isPlus = async (did: string): Promise<boolean> => (await resolvePlan(did)) === 'plus'

export function validateCaption(raw: string): Check<string> {
  const v = raw.trim()
  if (graphemeCount(v) > GALLERY_CAPTION_MAX) return { ok: false, error: `A caption can be at most ${GALLERY_CAPTION_MAX} characters.` }
  // Lexicon maxLength is 1400 bytes.
  if (new TextEncoder().encode(v).length > 1400) return { ok: false, error: 'The caption is too long.' }
  return { ok: true, value: v }
}

/** Gallery order: lowest `sort` first, records without one follow, newest first. */
export function orderGallery(images: StoredImage[]): StoredImage[] {
  const created = (i: StoredImage) => Date.parse(i.value.createdAt) || 0
  return [...images].sort((a, b) => {
    const sa = a.value.sort
    const sb = b.value.sort
    const ha = typeof sa === 'number'
    const hb = typeof sb === 'number'
    if (ha && hb) return sa - sb || created(b) - created(a)
    if (ha) return -1
    if (hb) return 1
    return created(b) - created(a)
  })
}

export async function listGallery(session: OAuthSession): Promise<StoredImage[]> {
  return orderGallery(await listGalleryRecords(session))
}

export type GalleryInput = Omit<NewImageInput, 'isDefault'> & { caption: string }

/** Validate every non-file field of the upload form. isDefault is always false. */
export function validateGalleryFields(input: GalleryInput): Check<NewImageFields & { caption?: string }> {
  const caption = validateCaption(input.caption)
  if (!caption.ok) return caption
  const fields = validateNewImage({ ...input, isDefault: false })
  if (!fields.ok) return fields
  return { ok: true, value: { ...fields.value, isDefault: false, ...(caption.value ? { caption: caption.value } : {}) } }
}

/** Plan gate and cap, checked against the PDS. Returns the current gallery. */
async function gatedGallery(session: OAuthSession): Promise<StoredImage[]> {
  if (!(await isPlus(session.did))) throw new RepoError(GALLERY_PLUS_MESSAGE)
  return listGallery(session)
}

export async function addGalleryImage(session: OAuthSession, bytes: Uint8Array, mime: ImageMime, input: GalleryInput): Promise<void> {
  const img = validateImageBytes(bytes)
  if (!img.ok) throw new RepoError(img.error)
  const fields = validateGalleryFields(input)
  if (!fields.ok) throw new RepoError(fields.error)
  const existing = await gatedGallery(session)
  if (existing.length >= GALLERY_MAX) throw new RepoError(galleryFullMessage)
  const blob = await uploadBlob(session, bytes, mime)
  const { alt, labels, license, caption } = fields.value
  const sorts = existing.map((i) => i.value.sort).filter((n): n is number => typeof n === 'number')
  const sort = sorts.length ? Math.max(...sorts) + 1 : existing.length
  const value: ImageRecord = {
    image: blob,
    ...(alt ? { alt } : {}),
    ...(labels ? { labels } : {}),
    license,
    purpose: 'gallery',
    ...(caption ? { caption } : {}),
    sort,
    createdAt: new Date().toISOString(),
  }
  await createImage(session, value)
}

/** Delete one gallery record. Avatar records and unknown keys are refused. */
export async function deleteGalleryImage(session: OAuthSession, rkey: string): Promise<void> {
  if (!GALLERY_RKEY_PATTERN.test(rkey)) throw new RepoError('Invalid image.')
  if (!(await isPlus(session.did))) throw new RepoError(GALLERY_PLUS_MESSAGE)
  const target = (await listGallery(session)).find((i) => i.rkey === rkey)
  if (!target) throw new RepoError('That gallery image no longer exists.')
  await xrpc(session, 'POST', 'com.atproto.repo.deleteRecord', { body: { repo: session.did, collection: IMAGE_COLLECTION, rkey } })
}

/** Move one gallery image a step earlier or later, then renumber `sort` as 0..n-1 where it changed. */
export async function moveGalleryImage(session: OAuthSession, rkey: string, direction: 'up' | 'down'): Promise<void> {
  if (!GALLERY_RKEY_PATTERN.test(rkey)) throw new RepoError('Invalid image.')
  const list = await gatedGallery(session)
  const i = list.findIndex((x) => x.rkey === rkey)
  if (i < 0) throw new RepoError('That gallery image no longer exists.')
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= list.length) return
  const next = [...list]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  const writes = next.flatMap((img, n) =>
    img.value.sort === n
      ? []
      : [{ $type: 'com.atproto.repo.applyWrites#update', collection: IMAGE_COLLECTION, rkey: img.rkey, value: { $type: IMAGE_COLLECTION, ...img.value, purpose: 'gallery', sort: n } }],
  )
  if (writes.length) await xrpc(session, 'POST', 'com.atproto.repo.applyWrites', { body: { repo: session.did, writes } })
}
