import { oauthClient } from '../../../lib/auth'

export const dynamic = 'force-dynamic'

/** Public keys only. The client's `jwks` getter strips private members. */
export async function GET() {
  try {
    const client = await oauthClient()
    return Response.json(client.jwks, { headers: { 'cache-control': 'public, max-age=300' } })
  } catch (err) {
    console.error("jwks unavailable", err instanceof Error ? err.message : "unknown")
    return Response.json({ error: 'signing key not configured' }, { status: 503 })
  }
}
