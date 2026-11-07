/**
 * Review portal settings that do not need a database: severity, SLA, policy list, wellness defaults (issue #209).
 * Everything here is pure so the web app and the indexer digest job share one definition.
 */
export const SEVERITIES = ['critical', 'high', 'moderate', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]
export const SEVERITY_LABELS: Record<Severity, string> = { critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low' }
export const severityRank = (s: Severity): number => SEVERITIES.indexOf(s)

/** 'manual' is a case a reviewer opened by hand from an account page. */
export type SignalKind = 'report' | 'scanner' | 'label' | 'appeal' | 'manual'

/** Categories that mean child safety, whatever the source. Such cases go to the restricted queue. */
export const CHILD_SAFETY_CATEGORIES = ['child_safety', 'csam'] as const
export const isChildSafety = (category: string): boolean => (CHILD_SAFETY_CATEGORIES as readonly string[]).includes(category)

const REPORT_SEVERITY: Record<string, Severity> = {
  illegal: 'high', explicit: 'moderate', impersonation: 'moderate', harassment: 'moderate', private_info: 'moderate', copyright: 'moderate', spam: 'low', other: 'low',
}
/** Scanner categories that are serious on their own. Anything else a scanner flags is Moderate. */
const SCANNER_HIGH = new Set(['illegal', 'explicit', 'sexual', 'violence', 'gore'])
/** Label values (atproto or a labeler) that are serious on their own. Other labels are Moderate. */
const LABEL_HIGH = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore', 'self-harm', 'illegal', '!takedown', '!suspend', '!hide'])

/**
 * Severity of one signal from its kind and category (documented in docs/moderation-v1.md).
 * Child safety is Critical. A case takes the most severe of its signals.
 */
export function deriveSeverity(kind: SignalKind, category: string): Severity {
  const c = category.toLowerCase()
  if (isChildSafety(c)) return 'critical'
  if (kind === 'report') return REPORT_SEVERITY[c] ?? 'low'
  if (kind === 'scanner') return SCANNER_HIGH.has(c) ? 'high' : 'moderate'
  if (kind === 'label') return LABEL_HIGH.has(c) ? 'high' : 'moderate'
  return 'moderate'
}

export type SlaHours = Record<Severity, number>
/**
 * First-response targets in hours. These are starting points, not a legal standard: no published source sets them.
 * Critical child safety work should be as soon as reasonably possible (18 U.S.C. 2258A), so ask counsel before relaxing it.
 */
export const DEFAULT_SLA_HOURS: SlaHours = { critical: 72, high: 72, moderate: 72, low: 72 }

/** MODERATION_SLA_HOURS="critical=72,high=72,moderate=72,low=72". Missing or invalid entries keep the default. */
export function slaHours(env: Record<string, string | undefined> = process.env): SlaHours {
  const out = { ...DEFAULT_SLA_HOURS }
  for (const part of (env.MODERATION_SLA_HOURS ?? '').split(/[,\s]+/)) {
    const [k, v] = part.split('=')
    const n = Number(v)
    if ((SEVERITIES as readonly string[]).includes(k ?? '') && Number.isFinite(n) && n > 0) out[k as Severity] = n
  }
  return out
}

export const slaDueAt = (openedAt: Date, severity: Severity, sla: SlaHours): Date => new Date(openedAt.getTime() + sla[severity] * 3_600_000)

export type SlaState = { dueAt: Date; breached: boolean; msLeft: number }
/** For an open case: due time and how much is left (negative once breached). For a resolved case, pass its resolvedAt as `now`. */
export function slaState(openedAt: Date, severity: Severity, sla: SlaHours, now: Date): SlaState {
  const dueAt = slaDueAt(openedAt, severity, sla)
  const msLeft = dueAt.getTime() - now.getTime()
  return { dueAt, breached: msLeft < 0, msLeft }
}

/** "3h 20m left" or "overdue by 2h 5m". */
export function formatSla(msLeft: number): string {
  const abs = Math.abs(msLeft)
  const h = Math.floor(abs / 3_600_000)
  const m = Math.floor((abs % 3_600_000) / 60_000)
  const span = h >= 48 ? `${Math.floor(h / 24)}d ${h % 24}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  return msLeft < 0 ? `overdue by ${span}` : `${span} left`
}

export type Policy = { id: string; label: string }
export const DEFAULT_POLICIES: Policy[] = [
  { id: 'child-safety', label: 'Child safety (CSAM and sexualization of minors)' },
  { id: 'illegal-content', label: 'Illegal content' },
  { id: 'adult-content-rating', label: 'Explicit sexual content rated G or PG' },
  { id: 'copyright', label: 'Copyright or trademark infringement' },
  { id: 'impersonation', label: 'Impersonation of a person or organization' },
  { id: 'harassment', label: 'Threats or harassment' },
  { id: 'private-info', label: 'Sharing private information' },
  { id: 'spam-abuse', label: 'Spam, scams, and abuse of the service' },
  { id: 'no-violation', label: 'No violation found' },
]

/** MODERATION_POLICIES="id=Label text;id2=Other label". Replaces the default list when it has at least one valid entry. */
export function policyList(env: Record<string, string | undefined> = process.env): Policy[] {
  const out: Policy[] = []
  for (const part of (env.MODERATION_POLICIES ?? '').split(';')) {
    const i = part.indexOf('=')
    const id = part.slice(0, i).trim()
    const label = part.slice(i + 1).trim()
    if (i > 0 && /^[a-z0-9][a-z0-9-]{0,40}$/.test(id) && label) out.push({ id, label })
  }
  return out.length ? out : DEFAULT_POLICIES
}

/** The label for a cited policy, or null when it is not in the configured list. */
export function citePolicy(id: unknown, env: Record<string, string | undefined> = process.env): Policy | null {
  return policyList(env).find((p) => p.id === String(id ?? '')) ?? null
}

/** MODERATION_CHILD_SAFETY_DIDS: when set, only these admins can open the child-safety queue. Unset means every admin can. */
export function canViewChildSafety(did: string, env: Record<string, string | undefined> = process.env): boolean {
  const list = (env.MODERATION_CHILD_SAFETY_DIDS ?? '').split(/[\s,]+/).filter(Boolean)
  return list.length === 0 || list.includes(did)
}

export const WELLNESS_DEFAULTS = { blurPx: 16, grayscale: true } as const
export const MAX_BLUR_PX = 40

/** Minutes a reviewer keeps a case without acting. */
export const LOCK_MINUTES = 15
/** Hours a skipped case stays out of that reviewer's next-case picks. */
export const SKIP_HOURS = 4

export type QueueName = 'unreviewed' | 'escalated' | 'appeals' | 'resolved' | 'child_safety'
export const QUEUES: { name: QueueName; label: string }[] = [
  { name: 'unreviewed', label: 'Unreviewed' },
  { name: 'escalated', label: 'Escalated' },
  { name: 'appeals', label: 'Appeals' },
  { name: 'resolved', label: 'Resolved' },
  { name: 'child_safety', label: 'Child safety (restricted)' },
]
