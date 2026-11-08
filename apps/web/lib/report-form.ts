import { SESSION_EXPIRED_MESSAGE } from './form-state'
import { MIN_DETAILS, REPORT_FIELDS, type ReportField, type ReportState, type ReportValues } from './report-limits'
import { parseReport, type ReportInput } from './reports'

export { REPORT_FIELDS, type ReportField, type ReportState, type ReportValues }

export const REPORT_THANKS = 'Thanks. Your report was received.'

/** Checks each field on its own, using parseReport as the one source of the rules, so every problem shows at once. */
export function reportFieldErrors(values: ReportValues): Partial<Record<ReportField, string>> {
  const fine = { did: 'did:plc:check', reporterDid: 'did:plc:check', source: 'profile', reason: 'other', details: 'x'.repeat(MIN_DETAILS), contact: 'a@b.co' }
  const errors: Partial<Record<ReportField, string>> = {}
  for (const f of REPORT_FIELDS) {
    const r = parseReport({ ...fine, [f]: values[f] })
    if (!r.ok && r.field === f) errors[f] = f === 'reason' ? 'Choose a reason for the report.' : r.error
  }
  return errors
}

export type ReportDeps = {
  reporterDid: string | null
  /** False when the database is not configured. */
  available: boolean
  submit: (input: ReportInput) => Promise<'sent' | 'limited'>
  report: (err: unknown) => void
}

/** Every failure returns the typed values. Success clears the form and says thanks. */
export async function runReport(form: FormData, deps: ReportDeps): Promise<ReportState> {
  const values: ReportValues = { reason: String(form.get('reason') ?? ''), details: String(form.get('details') ?? ''), contact: String(form.get('contact') ?? '') }
  if (!deps.reporterDid) return { values, sessionExpired: true, formError: SESSION_EXPIRED_MESSAGE }
  const errors = reportFieldErrors(values)
  if (Object.keys(errors).length) return { values, errors }
  const parsed = parseReport({ reporterDid: deps.reporterDid, did: form.get('did'), source: form.get('source'), ...values })
  if (!parsed.ok) return { values, formError: parsed.error }
  if (!deps.available) return { values, formError: 'Something went wrong. Try again later.' }
  try {
    const status = await deps.submit(parsed.value)
    if (status === 'limited') return { values, formError: 'Too many reports from this network or account. Try again later.' }
  } catch (err) {
    deps.report(err)
    return { values, formError: 'Something went wrong. Try again later.' }
  }
  return { done: REPORT_THANKS }
}
