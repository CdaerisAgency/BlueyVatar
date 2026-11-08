import type { FormState } from './form-state'
// Client-safe: no imports except types from form-state, so the report form can bundle it. lib/reports.ts re-exports these.
export const MIN_DETAILS = 10
export const MAX_DETAILS = 2000
export const MAX_CONTACT = 254

export const REASONS = ['child_safety', 'illegal', 'copyright', 'explicit', 'impersonation', 'harassment', 'private_info', 'spam', 'other'] as const
export type Reason = (typeof REASONS)[number]

export const REASON_LABELS: Record<Reason, string> = {
  child_safety: 'Child safety concern',
  illegal: 'Illegal content',
  copyright: 'Copyright or trademark infringement',
  explicit: 'Explicit content rated too low',
  impersonation: 'Impersonation',
  harassment: 'Threats or harassment',
  private_info: 'Private information',
  spam: 'Spam or scams',
  other: 'Something else',
}


export type ReportField = 'reason' | 'details' | 'contact'
export type ReportValues = Record<ReportField, string>
export type ReportState = FormState<ReportValues, ReportField>
export const REPORT_FIELDS: readonly ReportField[] = ['reason', 'details', 'contact']
