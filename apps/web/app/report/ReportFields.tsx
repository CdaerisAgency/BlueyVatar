'use client'

import { useActionState, useRef } from 'react'
import { Button } from '../../components/Button'
import { FieldError, FormNotices, fieldProps, useFocusResult } from '../../components/FormNotices'
import { MAX_DETAILS, MIN_DETAILS, REASONS, REASON_LABELS, REPORT_FIELDS, type ReportState } from '../../lib/report-limits'
import { submitReportAction } from './actions'

export function ReportFields({ did, source }: { did: string; source: string }) {
  const [state, action] = useActionState(submitReportAction, {} as ReportState)
  const summary = useRef<HTMLDivElement>(null)
  useFocusResult(state, 'report', REPORT_FIELDS, summary)
  const v = state.values
  const e = state.errors ?? {}
  const key = state.values ? 'r' : state.done ? 'd' : 'i'
  return (
    <form action={action} noValidate>
      <FormNotices prefix="report" labels={REPORT_FIELDS} state={state} summary={summary} />
      <input type="hidden" name="did" value={did} />
      <input type="hidden" name="source" value={source} />
      <p>
        <label>Reason{' '}
          <select {...fieldProps('report', 'reason', e.reason)} name="reason" key={`reason-${key}`} defaultValue={v?.reason ?? ''}>
            <option value="" disabled>Choose one</option>
            {REASONS.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
          </select>
          <FieldError prefix="report" name="reason" error={e.reason} />
        </label>
      </p>
      <p>
        <label>Details<br />
          <textarea {...fieldProps('report', 'details', e.details)} name="details" key={`details-${key}`} defaultValue={v?.details ?? ''} rows={4} maxLength={MAX_DETAILS} />
          <FieldError prefix="report" name="details" error={e.details} />
        </label>
        <small>At least {MIN_DETAILS} characters.</small>
      </p>
      <p>
        <label>Your email, so we can follow up{' '}
          <input {...fieldProps('report', 'contact', e.contact)} name="contact" key={`contact-${key}`} defaultValue={v?.contact ?? ''} type="email" maxLength={254} autoComplete="email" />
          <FieldError prefix="report" name="contact" error={e.contact} />
        </label>
      </p>
      <Button type="submit">Send report</Button>
    </form>
  )
}
