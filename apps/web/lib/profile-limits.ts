// Client-safe: no imports from @blueyvatar/core or node: modules, so the profile form can bundle it.
export const MAX_INTERESTS = 20
export const MAX_INTEREST_CHARS = 50
/** Room for every interest at full length plus a comma and space between them. */
export const INTERESTS_BOX_MAX_LENGTH = MAX_INTERESTS * MAX_INTEREST_CHARS + (MAX_INTERESTS - 1) * 2

// Languages, social links, and wallets (issue #242). Mirrors lexicons/com/blueyvatar/profile.json
// and packages/core/src/profile-extras.ts (a test keeps the two in step).
export const MAX_LANGUAGES = 10
export const MAX_LANGUAGE_TAG_LENGTH = 35
export const MAX_SOCIAL_LINKS = 10
export const MAX_SOCIAL_LABEL_GRAPHEMES = 50
export const MAX_SOCIAL_URL_LENGTH = 2048
export const MAX_WALLETS = 10
export const MAX_WALLET_CHAIN_GRAPHEMES = 32
export const MAX_WALLET_ADDRESS_GRAPHEMES = 128
export const MAX_WALLET_LABEL_GRAPHEMES = 50

export type LanguageRow = { tag: string; primary: boolean }
export type SocialLinkRow = { label: string; url: string }
export type WalletRow = { chain: string; address: string; label: string; visible: boolean }
export type RowList = 'languages' | 'socialLinks' | 'wallets'

export type ProfileField = 'jobTitle' | 'company' | 'location' | 'pronouns' | 'pronunciation' | 'timezone' | 'interests' | 'backgroundColor' | RowList
/** Row problems use keys like `wallets.2.address`. List-level problems use the list name. */
export type ProfileErrorKey = ProfileField | `${RowList}.${number}.${string}`
export type ProfileErrors = Partial<Record<ProfileErrorKey, string>>

export type ProfileTextField = Exclude<ProfileField, RowList>
export type ProfileValues = Record<ProfileTextField, string> & {
  clearBackgroundColor: boolean
  languages: LanguageRow[]
  socialLinks: SocialLinkRow[]
  wallets: WalletRow[]
}

/** Element id for a field or row key, safe for fragment links. */
export const fieldId = (key: string): string => `profile-${key.replace(/\./g, '-')}`

/** Grapheme count that works in the browser. Mirrors the server count. */
export function countGraphemes(s: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0
    for (const _ of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)) n++
    return n
  }
  return [...s].length
}

export type ProfileFormState = {
  /** Submitted values, set after a failed or successful save so the form keeps what was typed. */
  values?: ProfileValues
  errors?: ProfileErrors
  /** A problem that is not tied to one field (rate limit, repository error, expired session). */
  formError?: string
  sessionExpired?: boolean
  saved?: string
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
