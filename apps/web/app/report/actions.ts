'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { currentDid } from '../../lib/auth'
import { getPool } from '../../lib/store'
import { clientIp } from '../../lib/rate-limit'
import { hashIp, parseReport, submitReport } from '../../lib/reports'
import { reportError } from '../../lib/obs'

/** Requires a signed-in account, checked here and not only in the form. Errors are logged without the form values, so reporter contact never reaches logs. */
export async function submitReportAction(form: FormData): Promise<void> {
  const back = String(form.get('back') ?? '/')
  const dest = (status: string) => `${back.startsWith('/') && !back.startsWith('//') ? back.split('?')[0] : '/'}?report=${status}`
  const reporterDid = await currentDid()
  if (!reporterDid) return redirect(dest('signin'))
  const parsed = parseReport({
    reporterDid, did: form.get('did'), source: form.get('source'), reason: form.get('reason'), details: form.get('details'), contact: form.get('contact'),
  })
  if (!parsed.ok) return redirect(dest(parsed.field === 'did' ? 'invalid' : `invalid_${parsed.field}`))
  const pool = getPool()
  if (!pool) return redirect(dest('error'))
  const h = await headers()
  const ip = clientIp(h)
  let status = 'sent'
  try {
    const res = await submitReport(pool, parsed.value, hashIp(ip, process.env.REPORT_IP_SECRET ?? process.env.SESSION_SECRET ?? 'blueyvatar'))
    if (!res.ok) status = 'limited'
  } catch (err) {
    reportError('report submit failed', err)
    status = 'error'
  }
  return redirect(dest(status))
}
