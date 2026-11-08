import { MAX_INTERESTS, MAX_INTEREST_CHARS, validateProfileAll, type ProfileErrors, type ProfileField, type ProfileFields } from './records'

export const PROFILE_FIELDS: readonly ProfileField[] = ['jobTitle', 'company', 'location', 'pronouns', 'pronunciation', 'timezone', 'interests', 'backgroundColor']

export type ProfileValues = Record<ProfileField, string> & { clearBackgroundColor: boolean }

export type ProfileFormState = {
  /** Submitted values, set after a failed or successful save so the form keeps what was typed. */
  values?: ProfileValues
  errors?: ProfileErrors
  /** A problem that is not tied to one field (rate limit, repository error, expired session). */
  formError?: string
  sessionExpired?: boolean
  saved?: string
}

export function readProfileForm(form: FormData): ProfileValues {
  const values = Object.fromEntries(PROFILE_FIELDS.map((k) => [k, String(form.get(k) ?? '')])) as unknown as ProfileValues
  values.clearBackgroundColor = form.get('clearBackgroundColor') === 'on'
  return values
}

/** Live counts for the interests box. Matches the split used by the server. */
export function interestStats(raw: string): { count: number; tooLong: string[]; overLimit: boolean } {
  const seen = new Set<string>()
  const tooLong: string[] = []
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    if ([...t].length > MAX_INTEREST_CHARS) tooLong.push(t)
  }
  return { count: seen.size, tooLong, overLimit: seen.size > MAX_INTERESTS }
}

export type SaveDeps = {
  limited: (did: string) => Promise<string | null>
  save: (did: string, fields: ProfileFields) => Promise<void>
  report: (err: unknown) => void
  messageFor: (err: unknown) => string
  lowContrast: (color: string) => boolean
}
/** Validates, then saves. Every failure returns the submitted values so the form keeps them. */
export async function runProfileSave(did: string | null, form: FormData, deps: SaveDeps): Promise<ProfileFormState> {
  const values = readProfileForm(form)
  if (!did) return { values, sessionExpired: true, formError: 'Your session expired. Sign in again; what you typed stays on this page.' }
  const input = { ...values, backgroundColor: values.clearBackgroundColor ? '' : values.backgroundColor }
  const checked = validateProfileAll(input)
  if (!checked.ok) return { values, errors: checked.errors }
  const wait = await deps.limited(did)
  if (wait) return { values, formError: wait }
  try {
    await deps.save(did, checked.value)
  } catch (err) {
    deps.report(err)
    return { values, formError: deps.messageFor(err) }
  }
  const color = checked.value.backgroundColor
  const saved = color && deps.lowContrast(color)
    ? 'Profile saved. That background color has too little contrast with text, so your page will use the default colors. Pick a lighter or darker shade.'
    : 'Profile saved.'
  return { values, saved }
}
