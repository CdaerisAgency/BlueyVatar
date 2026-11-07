import { clientMetadata } from '../../lib/oauth'

// Read OAUTH_USE_PERMISSION_SET per request so flipping the flag needs a restart, not a rebuild.
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(clientMetadata())
}
