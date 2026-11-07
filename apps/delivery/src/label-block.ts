import { LabelView } from '@blueyvatar/core'
import type { IndexStore } from './store.js'

export const IMAGE_COLLECTION = 'com.blueyvatar.image'
export const imageUri = (did: string, rkey: string): string => `at://${did}/${IMAGE_COLLECTION}/${rkey}`
export const BSKY_PROFILE_COLLECTION = 'app.bsky.actor.profile'

/**
 * True when atproto labels remove this blob: a removal label (!takedown, !suspend, !hide) on the account, on an
 * image record that holds the blob, or on the Bluesky profile record. Issue #207.
 */
export async function labelBlocksBlob(index: IndexStore, did: string, cid: string): Promise<boolean> {
  const labels = await index.labelsFor(did)
  if (labels.length === 0) return false
  const images = [...(await index.serviceImages(did)), ...(await index.galleryImages(did))].filter((i) => i.cid === cid)
  const uris = [...images.map((i) => imageUri(did, i.rkey)), `at://${did}/${BSKY_PROFILE_COLLECTION}/self`]
  return new LabelView(did, labels).anyRecordRemoved(uris)
}
