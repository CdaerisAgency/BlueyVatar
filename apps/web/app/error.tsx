'use client'

import { COPY } from '../lib/copy'

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="bv-narrow">
      <h1>{COPY.error.title}</h1>
      <p>{COPY.error.body}</p>
      <button type="button" className="bv-primary" onClick={() => reset()}>
        {COPY.error.retry}
      </button>
    </main>
  )
}
