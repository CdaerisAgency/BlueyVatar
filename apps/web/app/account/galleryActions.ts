'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../lib/auth'
import { RepoError, repoSession } from '../../lib/repo'
import { validateImageBytes } from '../../lib/records'
import { GALLERY_PLUS_MESSAGE, addGalleryImage, deleteGalleryImage, isPlus, moveGalleryImage, validateGalleryFields } from '../../lib/gallery'

const back = (key: 'galleryError' | 'galleryDone', value: string): never => redirect(`/account?${key}=${encodeURIComponent(value)}#gallery`)

async function signedIn(): Promise<string> {
  const did = await currentDid()
  return did ?? redirect('/login')
}

function fail(err: unknown): never {
  console.error('gallery action failed', err instanceof Error ? err.message : 'unknown')
  return back('galleryError', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
}

export async function uploadGalleryImage(form: FormData): Promise<void> {
  const did = await signedIn()
  if (!isPlus(did)) return back('galleryError', GALLERY_PLUS_MESSAGE)
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return back('galleryError', 'Choose an image file.')
  if (file.size > 1_000_000) return back('galleryError', 'The image is larger than 1,000,000 bytes. Resize or compress it and try again.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const img = validateImageBytes(bytes)
  if (!img.ok) return back('galleryError', img.error)
  const input = {
    alt: String(form.get('alt') ?? ''),
    caption: String(form.get('caption') ?? ''),
    rating: String(form.get('rating') ?? ''),
    rLabel: String(form.get('rLabel') ?? ''),
    license: String(form.get('license') ?? ''),
  }
  const fields = validateGalleryFields(input)
  if (!fields.ok) return back('galleryError', fields.error)
  try {
    await addGalleryImage(await repoSession(did), bytes, img.value.mime, input)
  } catch (err) {
    return fail(err)
  }
  return back('galleryDone', 'Gallery image added.')
}

export async function removeGalleryImage(form: FormData): Promise<void> {
  const did = await signedIn()
  try {
    await deleteGalleryImage(await repoSession(did), String(form.get('rkey') ?? ''))
  } catch (err) {
    return fail(err)
  }
  return back('galleryDone', 'Gallery image deleted. Copies others already hold cannot be recalled.')
}

export async function moveGallery(form: FormData): Promise<void> {
  const did = await signedIn()
  const direction = form.get('direction') === 'up' ? 'up' : 'down'
  try {
    await moveGalleryImage(await repoSession(did), String(form.get('rkey') ?? ''), direction)
  } catch (err) {
    return fail(err)
  }
  return back('galleryDone', 'Gallery order updated.')
}
