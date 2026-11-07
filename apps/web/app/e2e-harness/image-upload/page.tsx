import { notFound } from 'next/navigation'
import ImageFileInput from '../../account/avatars/ImageFileInput'
import Report from './Report'

export const dynamic = 'force-dynamic'

/**
 * Browser-test harness for the upload crop flow. The real upload pages need a signed-in account and a PDS, which the
 * e2e server does not have. This page exists only when E2E_HARNESS=1 (set by playwright.config.ts) and is a 404 otherwise.
 */
export default function Page() {
  if (process.env.E2E_HARNESS !== '1') notFound()
  return (
    <main>
      <h1>Upload crop harness</h1>
      <Report>
        <ImageFileInput />
      </Report>
    </main>
  )
}
