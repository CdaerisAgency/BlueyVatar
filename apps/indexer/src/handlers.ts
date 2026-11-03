import { getPath, ratingFromLabels, readBlobRef, selfLabelValues } from '@blueyvatar/core'

/** Collections the indexer cares about (spec section 4). */
export const COLLECTIONS = {
  image: 'com.blueyvatar.image',
  profile: 'com.blueyvatar.profile',
  claim: 'com.blueyvatar.claim',
  bskyProfile: 'app.bsky.actor.profile',
} as const

export interface IndexWrites {
  upsertImage(row: { did: string; rkey: string; cid: string; mimeType: string; rating: string; isDefault: boolean; license: string | null; createdAt: string }): Promise<void>
  deleteImage(did: string, rkey: string): Promise<void>
  upsertProfile(did: string, record: Record<string, unknown>): Promise<void>
  deleteProfile(did: string): Promise<void>
  upsertClaim(did: string, rkey: string, record: Record<string, unknown>): Promise<void>
  deleteClaim(did: string, rkey: string): Promise<void>
  /** `status` is Tap's account status (active, deactivated, deleted, suspended, takendown). */
  setRepoStatus(did: string, handle: string | null, active: boolean, status?: string): Promise<void>
  /** Purge cached copies after a change (spec section 9). */
  purgeImages(did: string): Promise<void>
}

export interface RecordEvt {
  did: string
  collection: string
  rkey: string
  action: 'create' | 'update' | 'delete'
  record?: Record<string, unknown>
}

export async function handleRecord(evt: RecordEvt, db: IndexWrites): Promise<void> {
  const del = evt.action === 'delete'
  switch (evt.collection) {
    case COLLECTIONS.image: {
      if (del || !evt.record) {
        await db.deleteImage(evt.did, evt.rkey)
        await db.purgeImages(evt.did)
        return
      }
      const blob = readBlobRef(getPath(evt.record, 'image'))
      if (!blob) return
      await db.upsertImage({
        did: evt.did,
        rkey: evt.rkey,
        cid: blob.cid,
        mimeType: blob.mimeType,
        rating: ratingFromLabels(selfLabelValues(getPath(evt.record, 'labels'))),
        isDefault: getPath(evt.record, 'isDefault') === true,
        license: typeof evt.record.license === 'string' ? evt.record.license : null,
        createdAt: typeof evt.record.createdAt === 'string' ? evt.record.createdAt : new Date().toISOString(),
      })
      return
    }
    case COLLECTIONS.profile:
      if (del || !evt.record) await db.deleteProfile(evt.did)
      else await db.upsertProfile(evt.did, evt.record)
      return
    case COLLECTIONS.claim:
      if (del || !evt.record) await db.deleteClaim(evt.did, evt.rkey)
      else await db.upsertClaim(evt.did, evt.rkey, evt.record)
      return
    case COLLECTIONS.bskyProfile:
      // Read live by the delivery API; a change only needs cache purging.
      await db.purgeImages(evt.did)
      return
  }
}
