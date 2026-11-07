import type { Query } from './cases.js'
import { syncCases } from './cases.js'
import { SEVERITY_LABELS, slaDueAt, type Severity, type SlaHours } from './config.js'

export type Digest = {
  since: Date
  until: Date
  newReports: { category: string; count: number }[]
  slaBreaches: number
  oldestOpen: { id: number; severity: Severity; ageHours: number } | null
  openCases: number
  rejections: { service: string; reason: string; count: number }[]
  labelCases: number
  escalated: number
  appeals: number
  childSafetyOpen: number
}

const HOURS = 3_600_000

/** Counts for the last 24 hours and the current backlog. Only counts and ids: no DIDs, hashes, or image data leave the database. */
export async function buildDigest(q: Query, sla: SlaHours, now: Date = new Date()): Promise<Digest> {
  await syncCases(q)
  const since = new Date(now.getTime() - 24 * HOURS)
  const [reports, open, rej, labels, counts] = await Promise.all([
    q.query('SELECT reason AS category, count(*)::int AS count FROM reports WHERE created_at >= $1 GROUP BY reason ORDER BY count(*) DESC, reason', [since]),
    q.query("SELECT id::int AS id, severity, opened_at FROM review_cases WHERE status <> 'resolved' ORDER BY opened_at, id"),
    q.query('SELECT service, reason, count(*)::int AS count FROM upload_rejections WHERE created_at >= $1 GROUP BY service, reason ORDER BY count(*) DESC, service, reason', [since]),
    q.query("SELECT count(DISTINCT case_id)::int AS n FROM case_signals WHERE kind = 'label' AND created_at >= $1", [since]),
    q.query(`SELECT count(*) FILTER (WHERE status = 'escalated')::int AS escalated, count(*) FILTER (WHERE status = 'appeal')::int AS appeals,
                    count(*) FILTER (WHERE child_safety)::int AS child FROM review_cases WHERE status <> 'resolved'`),
  ])
  const first = open.rows[0]
  return {
    since, until: now,
    newReports: reports.rows as Digest['newReports'],
    slaBreaches: open.rows.filter((r) => slaDueAt(new Date(r.opened_at), r.severity, sla) < now).length,
    oldestOpen: first ? { id: first.id, severity: first.severity, ageHours: (now.getTime() - new Date(first.opened_at).getTime()) / HOURS } : null,
    openCases: open.rows.length,
    rejections: rej.rows as Digest['rejections'],
    labelCases: labels.rows[0]?.n ?? 0,
    escalated: counts.rows[0]?.escalated ?? 0,
    appeals: counts.rows[0]?.appeals ?? 0,
    childSafetyOpen: counts.rows[0]?.child ?? 0,
  }
}

/** True when every figure that needs attention is zero. The digest is then skipped unless MODERATION_DIGEST_ALWAYS is set. */
export function digestIsQuiet(d: Digest): boolean {
  return d.newReports.length === 0 && d.slaBreaches === 0 && d.openCases === 0 && d.rejections.length === 0 && d.labelCases === 0 && d.escalated === 0 && d.appeals === 0
}

const age = (h: number) => (h < 48 ? `${Math.max(0, Math.round(h))} hours` : `${Math.round(h / 24)} days`)
const sum = (xs: { count: number }[]) => xs.reduce((n, x) => n + x.count, 0)

export const CLOUDFLARE_DASHBOARD_URL = 'https://dash.cloudflare.com/'

/** Plain text. Counts and a portal link only: no images, no hashes, no account identifiers. */
export function formatDigest(d: Digest, publicUrl: string): { subject: string; text: string } {
  const portal = `${publicUrl.replace(/\/+$/, '')}/admin`
  const lines: string[] = []
  const byCat = d.newReports.length ? d.newReports.map((r) => `  ${r.category}: ${r.count}`).join('\n') : '  none'
  lines.push(`Moderation digest for the 24 hours up to ${d.until.toISOString().slice(0, 16).replace('T', ' ')} UTC.`, '')
  lines.push(`New reports: ${sum(d.newReports)}`, byCat, '')
  lines.push(`Open cases: ${d.openCases}`)
  lines.push(`SLA breaches (open and past due): ${d.slaBreaches}`)
  lines.push(d.oldestOpen ? `Oldest open case: #${d.oldestOpen.id}, ${SEVERITY_LABELS[d.oldestOpen.severity]}, open ${age(d.oldestOpen.ageHours)}` : 'Oldest open case: none', '')
  lines.push(`Escalations waiting: ${d.escalated}`, `Appeals waiting: ${d.appeals}`)
  lines.push(`Child-safety cases open (restricted queue): ${d.childSafetyOpen}`)
  lines.push(`Cases opened by labels: ${d.labelCases}`, '')
  lines.push(`Upload rejections: ${sum(d.rejections)}`)
  lines.push(...(d.rejections.length ? d.rejections.map((r) => `  ${r.service}, ${r.reason}: ${r.count}`) : ['  none']), '')
  lines.push(
    `Cloudflare CSAM Scanning Tool: Cloudflare sends its own once-daily email to the address set up in the dashboard, and says whether a block failed. This digest does not read it. Check it, and the tool settings, at ${CLOUDFLARE_DASHBOARD_URL} (Caching, Configuration, CSAM Scanning Tool).`, '',
    `Open the portal: ${portal}`, '',
    '--', 'Counts only. This email never contains images or the content of reports.',
  )
  const flag = d.slaBreaches > 0 ? `, ${d.slaBreaches} past SLA` : ''
  return { subject: `blueyvatar moderation digest: ${sum(d.newReports)} new reports, ${d.openCases} open${flag}`, text: lines.join('\n') }
}

