import { oauthClient } from '../../../lib/auth'
import { reportError } from '../../../lib/obs'

export const dynamic = 'force-dynamic'

/** Public keys only. The client's `jwks` getter strips private members. */
export async function GET() {
  try {
    const client = await oauthClient()
    return Response.json(client.jwks, { headers: { 'cache-control': 'public, max-age=300' } })
  } catch (err) {
    reportError('jwks unavailable', err)
    return Response.json({ error: 'signing key not configured' }, { status: 503 })
  }
}
