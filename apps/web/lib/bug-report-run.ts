import { limitedMessage } from './rate-limit'
import { isHoneypotFilled, issueBody, issueTitle, ISSUE_LABELS, MAX_REQUEST_BYTES, parseBugReport, UNAVAILABLE_MESSAGE, type FeedbackConfig } from './bug-report'

/** Server side of the bug report button. Every outside effect is passed in so tests can mock GitHub and the limiter. */
export type RunDeps = {
  /** The signed-in account, or null. */
  did: string | null
  config: FeedbackConfig | null
  /** Seconds to wait when this account or network is over its limit, else null. */
  limited: () => Promise<number | null>
  handleFor: (did: string) => Promise<string | null>
  version: string | null
  fetchImpl: typeof fetch
  report: (err: unknown) => void
}

type Failure = { status: 400 | 401 | 413 | 429 | 502 | 503; body: { ok: false; error: string; field?: string }; retryAfterSec?: number }
export type RunResult = { status: 200; body: { ok: true; number: number; url: string } } | Failure

const fail = (status: Failure['status'], error: string, field?: string): Failure => ({ status, body: { ok: false, error, ...(field ? { field } : {}) } })

export async function runBugReport(rawText: string, deps: RunDeps): Promise<RunResult> {
  if (!deps.did) return fail(401, 'Sign in to send a bug report.')
  if (!deps.config) return fail(503, UNAVAILABLE_MESSAGE)
  if (Buffer.byteLength(rawText) > MAX_REQUEST_BYTES) return fail(413, 'That report is too large.')
  let raw: unknown
  try {
    raw = JSON.parse(rawText)
  } catch {
    return fail(400, 'The report was not understood.', 'body')
  }
  // Counted before the checks so that probing the form costs the same as sending it.
  const over = await deps.limited()
  if (over !== null) return { ...fail(429, limitedMessage(over)), retryAfterSec: over }
  // A bot filled the hidden field. Answer like a success so it learns nothing, and file nothing.
  if (isHoneypotFilled(raw)) return { status: 200, body: { ok: true, number: 0, url: '' } }
  const parsed = parseBugReport(raw)
  if (!parsed.ok) return fail(400, parsed.error, parsed.field)
  const handle = parsed.value.includeHandle ? await deps.handleFor(deps.did).catch(() => null) : null
  try {
    const res = await deps.fetchImpl(`https://api.github.com/repos/${deps.config.repo}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.config.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': 'blueyvatar-bug-report',
      },
      body: JSON.stringify({ title: issueTitle(parsed.value.description), body: issueBody(parsed.value, { handle: handle ?? (parsed.value.includeHandle ? deps.did : null), version: deps.version }), labels: [...ISSUE_LABELS] }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      // Status only: the response body and the token never reach the logs.
      deps.report(new Error(`GitHub issue create failed: ${res.status}`))
      return fail(502, 'The report could not be filed. Try again later.')
    }
    const issue = (await res.json()) as { number?: number; html_url?: string }
    return { status: 200, body: { ok: true, number: Number(issue.number ?? 0), url: String(issue.html_url ?? '') } }
  } catch (err) {
    deps.report(new Error(`GitHub issue create failed: ${(err as Error).name}`))
    return fail(502, 'The report could not be filed. Try again later.')
  }
}
