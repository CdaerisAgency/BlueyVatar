import Link from 'next/link'
import { COPY } from '../lib/copy'

export default function NotFound() {
  return (
    <main className="bv-narrow">
      <h1>{COPY.notFound.title}</h1>
      <p>{COPY.notFound.body}</p>
      <Link href="/" className="bv-btn bv-primary">
        {COPY.notFound.home}
      </Link>
    </main>
  )
}
