'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { RepoError, createImage, deleteImage, listImages, repoSession, setDefaultImage, uploadBlob } from '../../../lib/repo'
import { canAddImage, limitMessage, planFor, validateImageBytes, validateNewImage } from '../../../lib/records'

const back = (key: 'error' | 'done', value: string): never => redirect(`/account/avatars?${key}=${encodeURIComponent(value)}`)

async function signedIn(): Promise<string> {
  const did = await currentDid()
  return did ?? redirect('/login')
}

function fail(err: unknown): never {
  console.error('avatar action failed', err instanceof Error ? err.message : 'unknown')
  return back('error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
}

export async function uploadImage(form: FormData): Promise<void> {
  const did = await signedIn()
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return back('error', 'Choose an image file.')
  // Reject oversized files before reading them into memory.
  if (file.size > 1_000_000) return back('error', 'The image is larger than 1,000,000 bytes. Resize or compress it and try again.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const img = validateImageBytes(bytes)
  if (!img.ok) return back('error', img.error)
  const fields = validateNewImage({
    alt: String(form.get('alt') ?? ''),
    rating: String(form.get('rating') ?? ''),
    rLabel: String(form.get('rLabel') ?? ''),
    license: String(form.get('license') ?? ''),
    isDefault: form.get('isDefault') === 'on',
  })
  if (!fields.ok) return back('error', fields.error)

  try {
    const session = await repoSession(did)
    const existing = await listImages(session)
    const plan = planFor(did)
    if (!canAddImage(existing.length, plan)) return back('error', limitMessage(plan))
    const blob = await uploadBlob(session, bytes, img.value.mime)
    const { alt, labels, license } = fields.value
    const isDefault = fields.value.isDefault || existing.length === 0
    const value = { image: blob, ...(alt ? { alt } : {}), ...(labels ? { labels } : {}), license, isDefault, createdAt: new Date().toISOString() }
    const ref = await createImage(session, value)
    if (isDefault) await setDefaultImage(session, { ...ref, rkey: ref.uri.slice(ref.uri.lastIndexOf('/') + 1), value })
  } catch (err) {
    return fail(err)
  }
  return back('done', 'Image added.')
}

export async function makeDefault(form: FormData): Promise<void> {
  const did = await signedIn()
  try {
    const session = await repoSession(did)
    const target = (await listImages(session)).find((i) => i.rkey === String(form.get('rkey') ?? ''))
    if (!target) return back('error', 'That image no longer exists.')
    await setDefaultImage(session, target)
  } catch (err) {
    return fail(err)
  }
  return back('done', 'Default image updated.')
}

export async function removeImage(form: FormData): Promise<void> {
  const did = await signedIn()
  const rkey = String(form.get('rkey') ?? '')
  if (!/^[A-Za-z0-9._~:-]{1,512}$/.test(rkey)) return back('error', 'Invalid image.')
  try {
    await deleteImage(await repoSession(did), rkey)
  } catch (err) {
    return fail(err)
  }
  return back('done', 'Image deleted. Copies others already hold cannot be recalled.')
}
