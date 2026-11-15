import type { OAuthSession } from '@atproto/oauth-client-node'
import { readCapped } from '../import'
import { createImage, listImages, deleteImage, repoSession, rkeyOf, setDefaultImage, uploadBlob, RepoError, type ImageRecord } from '../repo'
import { MAX_BLOB_BYTES, canAddImage, limitMessage, validateImageBytes } from '../records'
import { resolvePlan } from '../plan'
import { pushAfterDefaultChange } from '../push-server'
import { prepareUpload } from '../server-resize'
import { screenUpload } from '../upload-screen'
import type { FlowDeps, RepoPort } from './flow'
import { renderLook } from './render'
import { getEffectsStore } from './store'
import { myOffers } from './my-offers'

/** The repository port for one signed-in account, using the same record writes as an upload. */
export function repoPort(session: OAuthSession): RepoPort {
  return {
    list: () => listImages(session),
    async blob(img) {
      const cid = img.value.image.ref.$link
      const res = await session.fetchHandler(`/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did: session.did, cid })}`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return { ok: false, error: "Your image could not be read from your Bluesky account's home server." }
      const bytes = await readCapped(res, MAX_BLOB_BYTES)
      if (!bytes) return { ok: false, error: 'That image is larger than 5 MB.' }
      const v = validateImageBytes(bytes)
      return v.ok ? { ok: true, value: bytes } : { ok: false, error: v.error }
    },
    async add(bytes, mime, meta, makeDefault) {
      const existing = await listImages(session)
      const plan = await resolvePlan(session.did)
      if (!canAddImage(existing.length, plan)) throw new RepoError(limitMessage(plan))
      const blob = await uploadBlob(session, bytes, mime)
      const value: ImageRecord = {
        image: blob,
        ...(meta.alt ? { alt: meta.alt } : {}),
        ...(meta.labels ? { labels: meta.labels } : {}),
        isDefault: makeDefault || existing.length === 0,
        createdAt: new Date().toISOString(),
      }
      const ref = await createImage(session, value)
      if (value.isDefault) await setDefaultImage(session, { ...ref, rkey: rkeyOf(ref.uri), value })
      return rkeyOf(ref.uri)
    },
    remove: (rkey) => deleteImage(session, rkey),
    setDefault: (img) => setDefaultImage(session, img),
  }
}

/** Real dependencies for one account. Throws RepoError when the stored sign-in is gone. */
export async function liveDeps(did: string): Promise<FlowDeps> {
  const session = await repoSession(did)
  return {
    store: getEffectsStore(),
    repo: repoPort(session),
    plan: () => resolvePlan(did),
    grants: async () => (await myOffers(did)).map((o) => o.effect),
    render: renderLook,
    prepare: prepareUpload,
    screen: (bytes, mime) => screenUpload(did, bytes, mime),
    push: () => pushAfterDefaultChange(did),
    now: () => new Date(),
  }
}
