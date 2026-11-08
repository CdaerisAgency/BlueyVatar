import { validateProfileAll, type ProfileFields } from './records'
import type { LanguageRow, ProfileFormState, ProfileTextField, ProfileValues, RowList, SocialLinkRow, WalletRow } from './profile-limits'

export { interestStats, type ProfileFormState, type ProfileValues } from './profile-limits'

export const PROFILE_FIELDS: readonly ProfileTextField[] = ['jobTitle', 'company', 'location', 'pronouns', 'pronunciation', 'timezone', 'interests', 'backgroundColor']

/** Record keys that hold row lists. A save replaces them, so a cleared list is removed. */
export const PROFILE_LIST_FIELDS: readonly RowList[] = ['languages', 'socialLinks', 'wallets']

/** Row indexes present in the form for one list, in numeric order. Field names look like `wallets.2.address`. */
function rowIndexes(form: FormData, list: RowList): number[] {
  const found = new Set<number>()
  for (const key of form.keys()) {
    const m = new RegExp(`^${list}\\.(\\d{1,3})\\.`).exec(key)
    if (m) found.add(Number(m[1]))
  }
  return [...found].sort((a, b) => a - b).slice(0, 50)
}
const str = (form: FormData, k: string) => String(form.get(k) ?? '')

export function readProfileForm(form: FormData): ProfileValues {
  const values = Object.fromEntries(PROFILE_FIELDS.map((k) => [k, String(form.get(k) ?? '')])) as unknown as ProfileValues
  const primary = str(form, 'languagesPrimary')
  values.languages = rowIndexes(form, 'languages').map((i): LanguageRow => ({ tag: str(form, `languages.${i}.tag`), primary: primary === String(i) }))
  values.socialLinks = rowIndexes(form, 'socialLinks').map((i): SocialLinkRow => ({ label: str(form, `socialLinks.${i}.label`), url: str(form, `socialLinks.${i}.url`) }))
  values.wallets = rowIndexes(form, 'wallets').map((i): WalletRow => ({
    chain: str(form, `wallets.${i}.chain`),
    address: str(form, `wallets.${i}.address`),
    label: str(form, `wallets.${i}.label`),
    visible: form.get(`wallets.${i}.visible`) === 'on',
  }))
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
