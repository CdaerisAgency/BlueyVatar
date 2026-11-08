// Client-safe: no imports from @blueyvatar/core or node: modules, so the profile form can bundle it.
export const MAX_INTERESTS = 20
export const MAX_INTEREST_CHARS = 50
/** Room for every interest at full length plus a comma and space between them. */
export const INTERESTS_BOX_MAX_LENGTH = MAX_INTERESTS * MAX_INTEREST_CHARS + (MAX_INTERESTS - 1) * 2

export type ProfileField = 'jobTitle' | 'company' | 'location' | 'pronouns' | 'pronunciation' | 'timezone' | 'interests' | 'backgroundColor'
export type ProfileErrors = Partial<Record<ProfileField, string>>

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
