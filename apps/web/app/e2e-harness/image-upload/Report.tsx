'use client'

import { useState, type ReactNode } from 'react'

/** Wraps the file input in a form that reports the file it would post instead of posting it. */
export default function Report({ children }: { children: ReactNode }) {
  const [out, setOut] = useState('')
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const file = new FormData(e.currentTarget).get('file') as File
        const bmp = await createImageBitmap(file)
        const c = document.createElement('canvas')
        c.width = bmp.width
        c.height = bmp.height
        const ctx = c.getContext('2d')!
        ctx.drawImage(bmp, 0, 0)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        const top = r! > 200 ? 'red' : g! > 200 ? 'green' : b! > 200 ? 'blue' : 'other'
        setOut(`${file.type} ${bmp.width}x${bmp.height} ${file.size <= 1_000_000 ? 'under-cap' : 'over-cap'} top-left=${top}`)
        bmp.close()
      }}
    >
      {children}
      <button type="submit">Submit</button>
      <output data-testid="result">{out}</output>
    </form>
  )
}
