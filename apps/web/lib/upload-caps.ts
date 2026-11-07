import { MAX_BLOB_BYTES } from './records'

/** Files accepted in one upload request. The client sends one; anything more is refused. */
export const MAX_FILES_PER_UPLOAD = 1

/**
 * Server-side upload caps, applied whatever the client resized: exactly one non-empty file field, and no more than
 * MAX_BLOB_BYTES, checked from the declared size before the bytes are read into memory.
 * `validateImageBytes` still checks the real byte length and the image dimensions afterward.
 */
export function checkUploadForm(form: FormData): { ok: true; value: File } | { ok: false; error: string } {
  const files = form.getAll('file').filter((f): f is File => f instanceof File)
  if (files.length === 0 || files[0]!.size === 0) return { ok: false, error: 'Choose an image file.' }
  if (files.length > MAX_FILES_PER_UPLOAD) return { ok: false, error: 'Upload one image at a time.' }
  if (files[0]!.size > MAX_BLOB_BYTES) return { ok: false, error: 'The image is larger than 1,000,000 bytes. Resize or compress it and try again.' }
  return { ok: true, value: files[0]! }
}
