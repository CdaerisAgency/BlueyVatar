import { currentDid } from '../../lib/auth'
import { loginPath } from '../../lib/next-path'
import { MIN_DETAILS } from '../../lib/report-limits'
import type { Source } from '../../lib/reports'
import { ReportFields } from './ReportFields'

const NOTES: Record<string, string> = {
  sent: 'Thanks. Your report was received.',
  invalid: 'The report was not sent. Check the form and try again.',
  invalid_reason: 'Choose a reason for the report.',
  invalid_details: `Add details about the problem, at least ${MIN_DETAILS} characters.`,
  invalid_contact: 'Enter a valid email address so we can follow up.',
  signin: 'Sign in with Bluesky to send a report.',
  limited: 'Too many reports from this network or account. Try again later.',
  error: 'Something went wrong. Try again later.',
}

export async function ReportForm({ did, source, back, status }: { did: string; source: Source; back: string; status?: string }) {
  const signedIn = (await currentDid()) !== null
  const noun = source === 'avatar' ? 'avatar' : 'profile'
  return (
    <section aria-label="Report">
      {status && NOTES[status] && <p role="status">{NOTES[status]}</p>}
      <details open={Boolean(status && status.startsWith('invalid'))}>
        <summary>Report this {noun}</summary>
        {signedIn ? (
          <>
            <p>Reports are tied to your signed-in account and are never shown publicly. All fields are required. See the <a href="/policy">content policy</a>.</p>
            <ReportFields did={did} source={source} />
          </>
        ) : (
          <>
            <p>Sign in to send a report. See the <a href="/policy">content policy</a>.</p>
            <p><a href={loginPath(back)}>Sign in with Bluesky to report this {noun}</a></p>
            <p>Cannot sign in? For legal or urgent notices, write to <a href="mailto:security@blueyvatar.com">security@blueyvatar.com</a>.</p>
          </>
        )}
      </details>
    </section>
  )
}
