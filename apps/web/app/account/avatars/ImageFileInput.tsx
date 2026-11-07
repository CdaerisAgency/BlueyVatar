'use client'

import { useState } from 'react'
import { prepareImage } from '../../../lib/client-resize'

/** File input that downscales large images in the browser before the form posts. Best effort; see lib/client-resize.ts. */
export default function ImageFileInput() {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    setNote('')
    setError('')
    if (!file) return
    const result = await prepareImage(file)
    if (result.error !== undefined) {
      setError(result.error)
      input.value = ''
      return
    }
    const out = result.file
    if (out !== file) {
      try {
        const dt = new DataTransfer()
        dt.items.add(out)
        input.files = dt.files
        setNote(`Resized to ${Math.round(out.size / 1000)} KB before upload.`)
      } catch {
        // Browser cannot set files programmatically; the server will check the original.
      }
    }
  }

  return (
    <>
      <label>
        Image (PNG or JPEG, at least 80 by 80 pixels, up to 1,000,000 bytes after upload. Large images are resized in your browser first, and non-square images are cropped to the center square.){' '}
        <input name="file" type="file" accept="image/png,image/jpeg" required onChange={onChange} />
      </label>
      {error && <p role="alert">{error}</p>}
      {note && <p role="status">{note}</p>}
    </>
  )
}
