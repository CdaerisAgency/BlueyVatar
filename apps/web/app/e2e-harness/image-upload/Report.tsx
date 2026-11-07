'use client'

import { useState, type ReactNode } from 'react'

/** Wraps the file input in a form that reports the file and the crop fields it would post instead of posting them. */
export default function Report({ children }: { children: ReactNode }) {
  const [out, setOut] = useState('')
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        const file = data.get('file') as File
        const bmp = await createImageBitmap(file)
        const crop = ['cropX', 'cropY', 'cropSize'].map((k) => String(data.get(k) ?? ''))
        const cropText = crop.every((v) => v === '') ? 'none' : crop.join(',')
        setOut(`${file.type} ${bmp.width}x${bmp.height} ${file.size <= 5 * 1024 * 1024 ? 'under-cap' : 'over-cap'} crop=${cropText}`)
        bmp.close()
      }}
    >
      {children}
      <button type="submit">Submit</button>
      <output data-testid="result">{out}</output>
    </form>
  )
}
