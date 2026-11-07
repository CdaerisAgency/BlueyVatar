'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../../lib/auth'
import { loadImport } from '../../../../lib/import-load'
import { RepoError, listImages, repoSession, saveNewImage } from '../../../../lib/repo'
import { canAddImage, limitMessage, validateNewImage } from '../../../../lib/records'
import { resolvePlan } from '../../../../lib/plan'
import { limited } from '../../../../lib/rate-guard'

const back = (key: 'error' | 'done', value: string): never => redirect(`/account/avatars?${key}=${encodeURIComponent(value)}`)

/** Re-fetches the image on the server. The browser never supplies image bytes or URLs. */
export async function confirmImport(form: FormData): Promise<void> {
  const did = (await currentDid()) ?? redirect('/login')
  const source = String(form.get('source') ?? '')
  const fields = validateNewImage({
    alt: String(form.get('alt') ?? ''),
    rating: String(form.get('rating') ?? ''),
    rLabel: String(form.get('rLabel') ?? ''),
    license: String(form.get('license') ?? ''),
    isDefault: form.get('isDefault') === 'on',
  })
  if (!fields.ok) return redirect(`/account/avatars/import?source=${encodeURIComponent(source)}&error=${encodeURIComponent(fields.error)}`)
  const wait = await limited(['import.did', 'import.ip'], did)
  if (wait) return back('error', wait)
  try {
    const session = await repoSession(did)
    const plan = await resolvePlan(did)
    if (!canAddImage((await listImages(session)).length, plan)) return back('error', limitMessage(plan))
    const img = await loadImport(did, source)
    await saveNewImage(session, img.bytes, img.mime, fields.value)
  } catch (err) {
    console.error('import failed', err instanceof Error ? err.message : 'unknown')
    return back('error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
  }
  return back('done', 'Image imported.')
}
