import type { Query } from './cases.js'
import { SEVERITIES, slaDueAt, type Severity, type SlaHours } from './config.js'

export type Metrics = {
  windowDays: number
  /** Cases opened in the window that got a first action. Hours. */
  firstAction: { count: number; medianHours: number | null }
  /** Cases resolved in the window. `withinSla` counts those resolved before their due time. */
  resolve: { count: number; medianHours: number | null; withinSla: number; bySeverity: Record<Severity, { count: number; withinSla: number }> }
  backlog: { open: number; oldestHours: number | null; medianHours: number | null }
  /** Appeals decided in the window. */
  overturn: { decided: number; overturned: number; rate: number | null }
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const HOURS = 3_600_000

/** Numbers for the admin home. Computed from review_cases and appeals; small volumes, so rows are read and summarized here. */
export async function moderationMetrics(q: Query, sla: SlaHours, now: Date = new Date(), windowDays = 30): Promise<Metrics> {
  const since = new Date(now.getTime() - windowDays * 24 * HOURS)
  const [fa, rs, open, ap] = await Promise.all([
    q.query('SELECT opened_at, first_action_at FROM review_cases WHERE opened_at >= $1 AND first_action_at IS NOT NULL', [since]),
    q.query("SELECT severity, opened_at, resolved_at FROM review_cases WHERE status = 'resolved' AND resolved_at >= $1", [since]),
    q.query("SELECT opened_at FROM review_cases WHERE status <> 'resolved'"),
    q.query("SELECT count(*)::int AS decided, count(*) FILTER (WHERE status = 'overturned')::int AS overturned FROM appeals WHERE decided_at >= $1 AND status <> 'open'", [since]),
  ])
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, { count: 0, withinSla: 0 }])) as Metrics['resolve']['bySeverity']
  let within = 0
  for (const r of rs.rows) {
    const b = bySeverity[r.severity as Severity]
    b.count++
    if (new Date(r.resolved_at) <= slaDueAt(new Date(r.opened_at), r.severity, sla)) { b.withinSla++; within++ }
  }
  const ages = open.rows.map((r) => (now.getTime() - new Date(r.opened_at).getTime()) / HOURS)
  const decided: number = ap.rows[0]?.decided ?? 0
  const overturned: number = ap.rows[0]?.overturned ?? 0
  return {
    windowDays,
    firstAction: { count: fa.rows.length, medianHours: median(fa.rows.map((r) => (new Date(r.first_action_at).getTime() - new Date(r.opened_at).getTime()) / HOURS)) },
    resolve: { count: rs.rows.length, medianHours: median(rs.rows.map((r) => (new Date(r.resolved_at).getTime() - new Date(r.opened_at).getTime()) / HOURS)), withinSla: within, bySeverity },
    backlog: { open: ages.length, oldestHours: ages.length ? Math.max(...ages) : null, medianHours: median(ages) },
    overturn: { decided, overturned, rate: decided ? overturned / decided : null },
  }
}

export const fmtHours = (h: number | null): string => (h === null ? 'none yet' : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`)
