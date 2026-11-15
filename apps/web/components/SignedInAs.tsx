import { viewerFor } from '../lib/viewer'
import { displayName } from '../lib/viewer-core'

/** The "Signed in as" line under an account page header. */
export async function SignedInAs({ did }: { did: string }) {
  return <p>Signed in as {displayName(await viewerFor(did))}</p>
}
