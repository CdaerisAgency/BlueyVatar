'use server'

import { headers } from 'next/headers'
import { currentDid } from '../../lib/auth'
import { getPool } from '../../lib/store'
import { clientIp } from '../../lib/rate-limit'
import { hashIp, submitReport } from '../../lib/reports'
import { runReport, type ReportState } from '../../lib/report-form'
import { reportError } from '../../lib/obs'

/** Requires a signed-in account, checked here and not only in the form. Errors are logged without the form values, so reporter contact never reaches logs. */
export async function submitReportAction(_prev: ReportState, form: FormData): Promise<ReportState> {
  const pool = getPool()
  const ip = clientIp(await headers())
  return runReport(form, {
    reporterDid: await currentDid(),
    available: pool !== null,
    submit: async (input) => {
      const res = await submitReport(pool!, input, hashIp(ip, process.env.REPORT_IP_SECRET ?? process.env.SESSION_SECRET ?? 'blueyvatar'))
      return res.ok ? 'sent' : 'limited'
    },
    report: (err) => reportError('report submit failed', err),
  })
}
