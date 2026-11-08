import { validateProfileAll, type ProfileFields } from './records'
import type { ProfileField, ProfileFormState, ProfileValues } from './profile-limits'

export { interestStats, type ProfileFormState, type ProfileValues } from './profile-limits'

export const PROFILE_FIELDS: readonly ProfileField[] = ['jobTitle', 'company', 'location', 'pronouns', 'pronunciation', 'timezone', 'interests', 'backgroundColor']

export function readProfileForm(form: FormData): ProfileValues {
  const values = Object.fromEntries(PROFILE_FIELDS.map((k) => [k, String(form.get(k) ?? '')])) as unknown as ProfileValues
  values.clearBackgroundColor = form.get('clearBackgroundColor') === 'on'
  return values
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
