import { clientMetadata } from '../../lib/oauth'

export function GET() {
  return Response.json(clientMetadata())
}
