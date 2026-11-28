/**
 * Admin-editable limits: the catalog of settings an admin may change, with defaults, floors, and ceilings.
 * Defaults equal the values in tiers.ts, so an empty settings table changes nothing. Enterprise is never editable.
 * Import by subpath: `@blueyvatar/core/settings`.
 */

export interface ProfileAccess {
  anonymous: boolean
  free: boolean
  plus: boolean
  business: boolean
}

export interface SiteSettings {
  anonymousDaily: number
  keyedDaily: { free: number }
  keyedMonthly: { plus: number; business: number }
  maxSize: { free: number; plus: number; business: number }
  profileAccess: ProfileAccess
}

export type SettingKey =
  | 'limits.anonymousDaily'
  | 'limits.free.keyedDaily'
  | 'limits.plus.keyedMonthly'
  | 'limits.business.keyedMonthly'
  | 'sizes.free.maxSize'
  | 'sizes.plus.maxSize'
  | 'sizes.business.maxSize'
  | 'embeds.profileAccess'

export interface SettingDef {
  key: SettingKey
  kind: 'int' | 'access'
  label: string
  min?: number
  max?: number
  default: number | ProfileAccess
  note?: string
}

const BILLING_NOTE = 'Display and usage alerts only. Not billed yet.'

export const SETTING_DEFS: readonly SettingDef[] = [
  { key: 'limits.anonymousDaily', kind: 'int', label: 'Anonymous requests per day (per IP)', min: 50, max: 1_000_000, default: 100 },
  { key: 'limits.free.keyedDaily', kind: 'int', label: 'Free plan requests per day', min: 100, max: 10_000_000, default: 1_000 },
  { key: 'limits.plus.keyedMonthly', kind: 'int', label: 'Plus plan requests per month', min: 1_000, max: 100_000_000, default: 50_000, note: BILLING_NOTE },
  { key: 'limits.business.keyedMonthly', kind: 'int', label: 'Business plan requests per month', min: 10_000, max: 1_000_000_000, default: 1_000_000, note: BILLING_NOTE },
  { key: 'sizes.free.maxSize', kind: 'int', label: 'Free plan maximum image size (px)', min: 64, max: 2048, default: 512 },
  { key: 'sizes.plus.maxSize', kind: 'int', label: 'Plus plan maximum image size (px)', min: 64, max: 2048, default: 1024 },
  { key: 'sizes.business.maxSize', kind: 'int', label: 'Business plan maximum image size (px)', min: 64, max: 2048, default: 2048 },
  {
    key: 'embeds.profileAccess', kind: 'access', label: 'Who may use profile embeds',
    default: { anonymous: false, free: false, plus: true, business: true },
  },
]

export const DEFAULT_SETTINGS: SiteSettings = {
  anonymousDaily: 100,
  keyedDaily: { free: 1_000 },
  keyedMonthly: { plus: 50_000, business: 1_000_000 },
  maxSize: { free: 512, plus: 1024, business: 2048 },
  profileAccess: { anonymous: false, free: false, plus: true, business: true },
}

export type SettingRow = { key: string; value: unknown }

export type ValidateResult =
  | { ok: true; key: SettingKey; value: number | ProfileAccess }
  | { ok: false; error: string }

const ACCESS_KEYS = ['anonymous', 'free', 'plus', 'business'] as const

export function validateSetting(key: string, value: unknown): ValidateResult {
  const def = SETTING_DEFS.find((d) => d.key === key)
  if (!def) return { ok: false, error: `Unknown setting: ${key}` }
  if (def.kind === 'int') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return { ok: false, error: `${key} must be a whole number` }
    if (value < def.min! || value > def.max!) {
      return { ok: false, error: `${key} must be between ${def.min} and ${def.max}` }
    }
    return { ok: true, key: def.key, value }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: `${key} must be an object of four true/false values` }
  }
  const obj = value as Record<string, unknown>
  if (Object.keys(obj).length !== ACCESS_KEYS.length || !ACCESS_KEYS.every((k) => typeof obj[k] === 'boolean')) {
    return { ok: false, error: `${key} must have exactly anonymous, free, plus, and business as true/false values` }
  }
  return {
    ok: true,
    key: def.key,
    value: { anonymous: obj.anonymous as boolean, free: obj.free as boolean, plus: obj.plus as boolean, business: obj.business as boolean },
  }
}

function cloneDefaults(): SiteSettings {
  return structuredClone(DEFAULT_SETTINGS)
}

function apply(s: SiteSettings, key: SettingKey, v: number | ProfileAccess): void {
  switch (key) {
    case 'limits.anonymousDaily': s.anonymousDaily = v as number; break
    case 'limits.free.keyedDaily': s.keyedDaily.free = v as number; break
    case 'limits.plus.keyedMonthly': s.keyedMonthly.plus = v as number; break
    case 'limits.business.keyedMonthly': s.keyedMonthly.business = v as number; break
    case 'sizes.free.maxSize': s.maxSize.free = v as number; break
    case 'sizes.plus.maxSize': s.maxSize.plus = v as number; break
    case 'sizes.business.maxSize': s.maxSize.business = v as number; break
    case 'embeds.profileAccess': s.profileAccess = v as ProfileAccess; break
  }
}

/** Builds settings from stored rows. A bad row is skipped (its key is listed in `rejected`) and the default stays. */
export function parseSettings(rows: SettingRow[]): { settings: SiteSettings; rejected: string[] } {
  const settings = cloneDefaults()
  const rejected: string[] = []
  for (const row of rows) {
    const r = validateSetting(row.key, row.value)
    if (r.ok) apply(settings, r.key, r.value)
    else rejected.push(row.key)
  }
  return { settings, rejected }
}
