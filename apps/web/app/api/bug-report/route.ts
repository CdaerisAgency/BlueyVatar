import { NextResponse } from 'next/server'
import { currentDid } from '../../../lib/auth'
import { feedbackConfig } from '../../../lib/bug-report'
import { runBugReport } from '../../../lib/bug-report-run'
import { reportError } from '../../../lib/obs'
import { limitedResult } from '../../../lib/rate-guard'
import { siteUrl } from '../../../lib/site'
import { resolveHandle } from '../../../lib/viewer'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/** Tells the button whether to show: reports need the GitHub token, and the dialog needs to know if someone is signed in. Never cached, and never says anything about the token. */
export async function GET() {
  const signedIn = (await currentDid().catch(() => null)) !== null
  return NextResponse.json({ available: feedbackConfig() !== null, signedIn }, { headers: noStore })
}

/** Files a GitHub issue for a signed-in account. The token stays on the server. */
export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  if ((origin && origin !== siteUrl()) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ ok: false, error: 'The report was not understood.' }, { status: 400, headers: noStore })
  }
  const did = await currentDid().catch(() => null)
  const out = await runBugReport(await req.text(), {
    did,
    config: feedbackConfig(),
    limited: async () => {
      const r = await limitedResult(['bugReport.did', 'bugReport.ip'], did)
      return r.ok ? null : r.retryAfterSec
    },
    handleFor: resolveHandle,
    version: process.env.SENTRY_RELEASE ?? process.env.FLY_IMAGE_REF ?? null,
    fetchImpl: fetch,
    report: (err) => reportError('bug report failed', err),
  })
  const headers: Record<string, string> = { ...noStore }
  if (out.status === 429 && out.retryAfterSec) headers['Retry-After'] = String(out.retryAfterSec)
  return NextResponse.json(out.body, { status: out.status, headers })
}
