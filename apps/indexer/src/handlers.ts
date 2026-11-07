import { GALLERY_CAPTION_MAX, getPath, parseCrop, purposeOf, ratingFromLabels, readBlobRef, selfLabelValues } from '@blueyvatar/core'

/** Collections the indexer cares about (spec section 4). */
export const COLLECTIONS = {
  image: 'com.blueyvatar.image',
  profile: 'com.blueyvatar.profile',
  claim: 'com.blueyvatar.claim',
  bskyProfile: 'app.bsky.actor.profile',
  bskyLink: 'app.bsky.actor.link',
  tangledProfile: 'org.tangled.actor.profile',
  tangledLegacyProfile: 'sh.tangled.actor.profile',
} as const

export interface IndexWrites {
  upsertImage(row: { did: string; rkey: string; cid: string; mimeType: string; rating: string; isDefault: boolean; license: string | null; purpose: string; caption: string | null; sort: number | null; crop: { x: number; y: number; size: number } | null; createdAt: string }): Promise<void>
  /** Returns the blob CID of the deleted record, when known, so its cached URLs can be purged. */
  deleteImage(did: string, rkey: string): Promise<string | undefined | void>
  upsertProfile(did: string, record: Record<string, unknown>): Promise<void>
  deleteProfile(did: string): Promise<void>
  upsertClaim(did: string, rkey: string, record: Record<string, unknown>): Promise<void>
  deleteClaim(did: string, rkey: string): Promise<void>
  upsertProfileLink(row: { did: string; rkey: string; cid: string; url: string; title: string | null; createdAt: string }): Promise<void>
  deleteProfileLink(did: string, rkey: string): Promise<void>
  /** `status` is Tap's account status (active, deactivated, deleted, suspended, takendown). */
  setRepoStatus(did: string, handle: string | null, active: boolean, status?: string): Promise<void>
  /** Purge cached copies after a change (spec section 9). Without `cids`, purges the repo's indexed images. */
  purgeImages(did: string, cids?: string[], opts?: { warm?: boolean }): Promise<void>
}

export interface RecordEvt {
  did: string
  collection: string
  rkey: string
  /** Record CID from Tap. Needed for link records, whose strongRefs pin a CID. */
  cid?: string
  action: 'create' | 'update' | 'delete'
  record?: Record<string, unknown>
}

export async function handleRecord(evt: RecordEvt, db: IndexWrites): Promise<void> {
  const del = evt.action === 'delete'
  switch (evt.collection) {
    case COLLECTIONS.image: {
      if (del || !evt.record) {
        const cid = await db.deleteImage(evt.did, evt.rkey)
        await db.purgeImages(evt.did, cid ? [cid] : undefined)
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
        purpose: purposeOf(evt.record.purpose),
        caption: typeof evt.record.caption === 'string' && evt.record.caption.trim() !== '' ? [...evt.record.caption].slice(0, GALLERY_CAPTION_MAX).join('') : null,
        sort: Number.isSafeInteger(evt.record.sort) && Math.abs(evt.record.sort as number) < 2 ** 31 ? (evt.record.sort as number) : null,
        crop: parseCrop(evt.record.crop),
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
    case COLLECTIONS.bskyLink: {
      // Which links show, and in what order, is decided by app.bsky.actor.profile#links. The
      // profile API resolves those refs against this table at read time.
      if (del || !evt.record) {
        await db.deleteProfileLink(evt.did, evt.rkey)
        return
      }
      if (typeof evt.record.url !== 'string' || !evt.cid) return
      await db.upsertProfileLink({
        did: evt.did,
        rkey: evt.rkey,
        cid: evt.cid,
        url: evt.record.url,
        title: typeof evt.record.title === 'string' ? evt.record.title : null,
        createdAt: typeof evt.record.createdAt === 'string' ? evt.record.createdAt : new Date().toISOString(),
      })
      return
    }
    case COLLECTIONS.tangledProfile:
    case COLLECTIONS.tangledLegacyProfile:
    case COLLECTIONS.bskyProfile:
      // Tangled profiles use the same path: the avatar is read live and only the cache changes.
      // Read live by the delivery API; a change only needs cache purging. A label change
      // (such as !no-unauthenticated) takes effect through the same purge. The Bluesky avatar
      // is not in the images table, so its CID is purged explicitly.
      // The avatar changed or may have, so the purged images are warmed again afterward.
      await db.purgeImages(evt.did, undefined, { warm: true })
      if (evt.record) {
        const avatar = readBlobRef(getPath(evt.record, 'avatar'))
        if (avatar) await db.purgeImages(evt.did, [avatar.cid], { warm: true })
      }
      return
  }
}
