'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../../lib/auth'
import { loadImport } from '../../../../lib/import-load'
import { RepoError, listImages, repoSession, saveNewImage } from '../../../../lib/repo'
import { prepareUpload } from '../../../../lib/server-resize'
import { canAddImage, limitMessage } from '../../../../lib/records'
import { runImport, type ImportState } from '../../../../lib/import-form'
import { resolvePlan } from '../../../../lib/plan'
import { reportError } from '../../../../lib/obs'
import { limited } from '../../../../lib/rate-guard'
import { screenUpload } from '../../../../lib/upload-screen'
import { syncBlueskyAfterDefaultChange } from '../../../../lib/bsky-sync-server'
import { syncsAfterImport } from '../../../../lib/bsky-sync'

const back = (key: 'done', value: string): never => redirect(`/account/avatars?${key}=${encodeURIComponent(value)}`)

/** Re-fetches the image on the server. The browser never supplies image bytes or URLs. Failures return to the form so typed values stay. */
export async function confirmImport(_prev: ImportState, form: FormData): Promise<ImportState> {
  const source = String(form.get('source') ?? '')
  const r = await runImport(await currentDid(), form, {
    limited: (did) => limited(['import.did', 'import.ip'], did),
    run: async (did, fields) => {
      const session = await repoSession(did)
      const plan = await resolvePlan(did)
      if (!canAddImage((await listImages(session)).length, plan)) return { ok: false, error: limitMessage(plan) }
      const img = await loadImport(did, source)
      const ready = await prepareUpload(img.bytes)
      if (!ready.ok) throw new RepoError(ready.error)
      const screened = await screenUpload(did, ready.value.bytes, ready.value.mime) // after downscaling, before the PDS write
      if (!screened.ok) throw new RepoError(screened.error)
      await saveNewImage(session, ready.value.bytes, ready.value.mime, fields)
      // An image imported from the Bluesky avatar is already what Bluesky shows, so nothing is written back.
      return { ok: true, note: syncsAfterImport(source, fields.isDefault) ? await syncBlueskyAfterDefaultChange(did) : null }
    },
    report: (err) => reportError('import failed', err),
    messageFor: (err) => (err instanceof RepoError ? err.message : 'Something went wrong. Try again.'),
  })
  if (r.done) return back('done', r.done)
  return r
}
