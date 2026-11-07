'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { RepoError, deleteImage, listImages, repoSession, saveNewImage, setDefaultImage } from '../../../lib/repo'
import { limited } from '../../../lib/rate-guard'
import { validateImageBytes, validateNewImage } from '../../../lib/records'
import { checkUploadForm } from '../../../lib/upload-caps'

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
  const wait = await limited(['upload.did', 'upload.ip'], did)
  if (wait) return back('error', wait)
  // Count and size are checked here whatever the browser resized; dimensions are checked in validateImageBytes below.
  const picked = checkUploadForm(form)
  if (!picked.ok) return back('error', picked.error)
  const file = picked.value
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
    await saveNewImage(await repoSession(did), bytes, img.value.mime, fields.value)
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
