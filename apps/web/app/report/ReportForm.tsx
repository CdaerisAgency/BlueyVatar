import { Button } from '../../components/Button'
import { REASONS, REASON_LABELS, MAX_DETAILS, type Source } from '../../lib/reports'
import { submitReportAction } from './actions'

const NOTES: Record<string, string> = {
  sent: 'Thanks. Your report was received.',
  invalid: 'The report was not sent. Check the form and try again.',
  limited: 'Too many reports from this network. Try again later.',
  error: 'Something went wrong. Try again later.',
}

export function ReportForm({ did, source, back, status }: { did: string; source: Source; back: string; status?: string }) {
  return (
    <section aria-label="Report">
      {status && NOTES[status] && <p role="status">{NOTES[status]}</p>}
      <details>
        <summary>Report this {source === 'avatar' ? 'avatar' : 'profile'}</summary>
        <p>No account needed. See the <a href="/policy">content policy</a>.</p>
        <form action={submitReportAction}>
          <input type="hidden" name="did" value={did} />
          <input type="hidden" name="source" value={source} />
          <input type="hidden" name="back" value={back} />
          <p>
            <label>Reason{' '}
              <select name="reason" required defaultValue="">
                <option value="" disabled>Choose one</option>
                {REASONS.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
              </select>
            </label>
          </p>
          <p><label>Details<br /><textarea name="details" rows={4} maxLength={MAX_DETAILS} /></label></p>
          <p>
            <label>Your email, if you want a reply (optional){' '}
              <input type="email" name="contact" maxLength={254} autoComplete="email" />
            </label>
          </p>
          <Button type="submit">Send report</Button>
        </form>
      </details>
    </section>
  )
}
