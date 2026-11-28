import { SETTING_DEFS, type ProfileAccess, type SiteSettings } from '@blueyvatar/core/settings'
import { ADMIN_SETTINGS_COPY } from '../copy/admin'

/** Pure helpers for the admin settings page: reading the form, warning about odd combinations, and summarizing audit rows. */

/** Whole numbers only. Digits may be grouped with commas, spaces, or underscores. Anything else is null. */
export function parseIntField(raw: string): number | null {
  const t = raw.trim()
  if (!/^\d+(?:[,_ ]\d+)*$/.test(t)) return null
  const n = Number(t.replace(/[,_ ]/g, ''))
  return Number.isSafeInteger(n) ? n : null
}

const WHO = ['anonymous', 'free', 'plus', 'business'] as const

/** One change per int field (null when it is not a whole number, so validation names it) and one for profile access. */
export function formChanges(form: FormData): { key: string; value: unknown }[] {
  const out: { key: string; value: unknown }[] = []
  for (const d of SETTING_DEFS) {
    if (d.kind !== 'int') continue
    const raw = form.get(d.key)
    if (typeof raw !== 'string') continue
    out.push({ key: d.key, value: parseIntField(raw) })
  }
  const access = Object.fromEntries(WHO.map((w) => [w, form.has(`embeds.profileAccess.${w}`)]))
  out.push({ key: 'embeds.profileAccess', value: access })
  return out
}

/** Combinations that are allowed but probably a mistake. */
export function crossPlanWarnings(s: SiteSettings): string[] {
  const w: string[] = []
  if (s.maxSize.free > s.maxSize.plus) w.push('The free plan maximum image size is above the Plus plan maximum.')
  if (s.maxSize.plus > s.maxSize.business) w.push('The Plus plan maximum image size is above the Business plan maximum.')
  if (s.keyedDaily.free * 30 > s.keyedMonthly.plus) w.push('The free plan daily limit, over 30 days, is above the Plus plan monthly limit.')
  return w
}

const show = (v: unknown): string => {
  if (v === null || v === undefined) return 'none'
  if (typeof v === 'string') return v.length === 64 && /^[0-9a-f]+$/.test(v) ? v.slice(0, 8) : v
  if (typeof v === 'object') {
    const on = WHO.filter((k) => (v as Partial<ProfileAccess>)[k] === true)
    return on.length ? on.join(', ') : 'nobody'
  }
  return String(v)
}

/** `key: before → after` for a settings or asset audit row; null for any other detail. */
export function auditSummary(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null
  const d = detail as { key?: unknown; name?: unknown; before?: unknown; after?: unknown }
  const label = typeof d.key === 'string' ? d.key : typeof d.name === 'string' ? d.name : null
  if (!label || !('before' in d) || !('after' in d)) return null
  return `${label}: ${show(d.before)} → ${show(d.after)}`
}

/** What the settings form returns to the browser after a failed save: messages per field and the values as typed. */
export type SaveState = { errors: Record<string, string>; values: Record<string, string> } | null

/** The submitted text of every settings field (numbers as typed, access boxes as "on" or ""), so a failed save keeps what was typed. */
export function submittedValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of SETTING_DEFS) if (d.kind === 'int') out[d.key] = String(form.get(d.key) ?? '')
  for (const w of WHO) out[`embeds.profileAccess.${w}`] = form.has(`embeds.profileAccess.${w}`) ? 'on' : ''
  return out
}

/** Turns validator errors (dotted keys) into messages that use the field label and grouped numbers. */
export function friendlyErrors(errors: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(errors)) {
    const d = SETTING_DEFS.find((x) => x.key === key)
    out[key] = d && d.kind === 'int'
      ? ADMIN_SETTINGS_COPY.msg.badInt(d.label, d.min!.toLocaleString('en-US'), d.max!.toLocaleString('en-US'))
      : ADMIN_SETTINGS_COPY.msg.badField(d?.label ?? 'Setting')
  }
  return out
}
