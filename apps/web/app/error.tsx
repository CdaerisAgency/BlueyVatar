'use client'

import { Button } from '../components/Button'
import { PageMain } from '../components/Page'
import { COPY } from '../lib/copy'

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageMain narrow>
      <h1>{COPY.error.title}</h1>
      <p>{COPY.error.body}</p>
      <Button type="button" variant="primary" onClick={() => reset()}>
        {COPY.error.retry}
      </Button>
    </PageMain>
  )
}
