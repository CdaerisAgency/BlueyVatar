import { NextResponse } from 'next/server'
import { currentViewer } from '../../../lib/viewer'
import { publicDeliveryBase } from '../../../lib/avatar-preview'
import { viewerPayload } from '../../../lib/viewer-core'

export const dynamic = 'force-dynamic'

/** Who is signed in, for the header and footer. Public pages are static, so they ask after load. Never cached. */
export async function GET() {
  const viewer = await currentViewer().catch(() => null)
  return NextResponse.json(viewerPayload(viewer, publicDeliveryBase()), { headers: { 'Cache-Control': 'no-store' } })
}
