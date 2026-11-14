/**
 * Bug report button (issue 266). Pure rules shared by the dialog and the API route: limits, input checks,
 * and the text of the GitHub issue. No server imports, so the client component can bundle it.
 *
 * Adapted from Cadence's report widget (packages/shell/src/ReportButton.tsx, packages/ui/src/screenshot.ts,
 * packages/adapters/src/github-issues-server.ts). What changed here is listed in docs/deploy.md, Bug reports.
 */

export const MIN_DESCRIPTION = 10
export const MAX_DESCRIPTION = 2000
export const MAX_CONTACT = 254
export const MAX_PAGE = 300
export const MAX_AGENT = 300
/** Longest edge of a kept screenshot, in pixels. A screen is readable at this size and the file stays small. */
export const SCREENSHOT_MAX_EDGE = 1600
/** Largest picture the dialog will open (before it is re-encoded), in bytes. */
export const SCREENSHOT_MAX_INPUT_BYTES = 10 * 1024 * 1024
/** Largest screenshot the dialog will keep after it is re-encoded, in bytes. */
export const SCREENSHOT_MAX_BYTES = 1024 * 1024
/** Common image types only. Anything else is refused when it is chosen. */
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
/** More links than this reads as spam. */
export const MAX_LINKS = 3
/** Largest request body the route reads, in bytes. The screenshot is never sent, so this is generous. */
export const MAX_REQUEST_BYTES = 16 * 1024

export const DEFAULT_FEEDBACK_REPO = 'CdaerisAgency/BlueyVatar'
/** Existing labels only, so filing an issue never creates a new one. `bug` and the `area:` prefix are the repo's own. */
export const ISSUE_LABELS = ['bug', 'area:web'] as const

export const UNAVAILABLE_MESSAGE = 'Bug reports are unavailable right now.'

export type FeedbackConfig = { token: string; repo: string }

/**
 * The credential and repository, read from the environment on each call (never at build time, so the Fly secret
 * counts). Null when the token is unset or the repository name is malformed: the button is then hidden and the
 * route answers 503.
 */
export function feedbackConfig(env: Record<string, string | undefined> = process.env): FeedbackConfig | null {
  const token = env.GITHUB_FEEDBACK_TOKEN?.trim()
  if (!token) return null
  const repo = env.GITHUB_FEEDBACK_REPO?.trim() || DEFAULT_FEEDBACK_REPO
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null
  return { token, repo }
}

export type BugReportInput = {
  description: string
  /** Empty when the person gave none. */
  contact: string
  includeHandle: boolean
  /** Path only, no query or fragment. */
  page: string
  userAgent: string
  viewport: string
  hasScreenshot: boolean
}

export type ParseResult = { ok: true; value: BugReportInput } | { ok: false; field: 'description' | 'contact' | 'page' | 'body'; error: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(control, '').trim().slice(0, max) : '')

/** The path of a page address, without query or fragment, which can carry tokens or codes. Empty when it is not a path. */
export function pagePath(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim().slice(0, 2000)
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\')) return ''
  try {
    return new URL(s, 'https://placeholder.invalid').pathname.slice(0, MAX_PAGE)
  } catch {
    return ''
  }
}

export function countLinks(s: string): number {
  return (s.match(/https?:\/\/|www\./gi) ?? []).length
}

/** Checks the request body. The spam rules live here: the hidden `website` field must be empty and links are capped. */
export function parseBugReport(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, field: 'body', error: 'The report was not understood.' }
  const o = raw as Record<string, unknown>
  const description = typeof o.description === 'string' ? o.description.replace(control, '').trim() : ''
  if (description.length < MIN_DESCRIPTION) return { ok: false, field: 'description', error: `Describe the problem in at least ${MIN_DESCRIPTION} characters.` }
  if (description.length > MAX_DESCRIPTION) return { ok: false, field: 'description', error: `Keep the description under ${MAX_DESCRIPTION} characters.` }
  if (countLinks(description) > MAX_LINKS) return { ok: false, field: 'description', error: `Use at most ${MAX_LINKS} links in a report.` }
  const contact = text(o.contact, MAX_CONTACT + 1)
  if (contact && (contact.length > MAX_CONTACT || !EMAIL.test(contact))) return { ok: false, field: 'contact', error: 'Enter a valid email address, or leave it empty.' }
  const w = Number(o.viewportWidth)
  const h = Number(o.viewportHeight)
  const viewport = Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w < 20000 && h < 20000 ? `${w}x${h}` : ''
  return {
    ok: true,
    value: {
      description,
      contact,
      includeHandle: o.includeHandle === true,
      page: pagePath(o.page),
      userAgent: text(o.userAgent, MAX_AGENT),
      viewport,
      hasScreenshot: o.hasScreenshot === true,
    },
  }
}

/** True when the hidden field a person never sees was filled in. */
export function isHoneypotFilled(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && typeof (raw as { website?: unknown }).website === 'string' && (raw as { website: string }).website.trim() !== ''
}

/** Stops a report from pinging people or linking to other issues: "@name" and "#12" become plain text. */
export function neutralize(s: string): string {
  return s.replace(/(^|[^\w.])@(?=[A-Za-z0-9])/g, '$1@\u200b').replace(/(^|[^\w&])#(?=\d)/g, '$1#\u200b')
}

export function issueTitle(description: string): string {
  const first = description.split('\n').find((l) => l.trim() !== '')?.trim() ?? 'Bug report'
  const flat = neutralize(first.replace(/[`*_[\]<>]/g, ''))
  return `Bug report: ${flat.length > 70 ? `${flat.slice(0, 69).trimEnd()}...` : flat}`
}

/**
 * The issue text. The handle is named only when the person agreed; the contact email only when they typed one
 * (the dialog says it appears in the issue). The screenshot itself is never in the issue.
 */
export function issueBody(input: BugReportInput, extra: { handle: string | null; version: string | null }): string {
  const lines = [neutralize(input.description), '', '---', '']
  lines.push(`Reported by ${extra.handle ? `**${neutralize(extra.handle)}**` : 'a signed-in account (handle not shared)'}`)
  if (input.contact) lines.push(`Contact: ${neutralize(input.contact)}`)
  const where = [input.page ? `on \`${input.page.replace(/`/g, '')}\`` : null, input.viewport ? `window ${input.viewport}` : null, extra.version ? `build \`${extra.version.replace(/`/g, '').slice(0, 80)}\`` : null].filter(Boolean)
  if (where.length) lines.push(`Reported ${where.join(', ')}`)
  if (input.userAgent) lines.push(`<sub>${neutralize(input.userAgent).replace(/[<>&]/g, ' ')}</sub>`)
  if (input.hasScreenshot) lines.push('The reporter has a screenshot. It is not stored with this issue; ask them to add it here.')
  return lines.join('\n')
}

/** What the dialog tells the person is sent, in the order the issue shows it. */
export function sentSummary(ctx: { page: string; viewport: string; hasContact: boolean; includeHandle: boolean }): string[] {
  return [
    `Your description`,
    `The page you were on: ${ctx.page || 'unknown'}`,
    `Your browser name and version, and window size ${ctx.viewport || 'unknown'}`,
    `The app version`,
    ctx.includeHandle ? 'Your handle' : 'No handle',
    ctx.hasContact ? 'Your contact email' : 'No contact email',
  ]
}

/** Why a picture is refused, or null when it is fine to open. Checked before the file is read. */
export function screenshotProblem(file: { type: string; size: number }): string | null {
  if (!(SCREENSHOT_TYPES as readonly string[]).includes(file.type)) return 'Use a PNG, JPEG, or WebP picture.'
  if (file.size > SCREENSHOT_MAX_INPUT_BYTES) return `That picture is over ${SCREENSHOT_MAX_INPUT_BYTES / 1024 / 1024} MB. Choose a smaller one.`
  return null
}
