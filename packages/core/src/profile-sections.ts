/**
 * Per-section visibility on com.blueyvatar.profile (issue #291).
 *
 * `hiddenSections` is a list of section names the owner chose to hide. Every public output (the
 * profile JSON, the page, and the JSON, Markdown, and vCard exports) passes its profile object
 * through `applyHiddenSections`, which removes the hidden sections' keys entirely. Unknown names
 * are ignored on read, so a newer record never breaks an older reader. Import this module by
 * subpath: `@blueyvatar/core/profile-sections`.
 */
export const HIDDEN_SECTIONS = ['links', 'languages', 'wallets', 'interests', 'gallery', 'verifiedAccounts'] as const
export type HiddenSection = (typeof HIDDEN_SECTIONS)[number]

/** Output keys removed for each section. "links" covers the atproto links and the owner's social links. */
export const SECTION_KEYS: Record<HiddenSection, readonly string[]> = {
  links: ['links', 'socialLinks'],
  languages: ['languages'],
  wallets: ['wallets'],
  interests: ['interests'],
  gallery: ['gallery'],
  verifiedAccounts: ['verifiedAccounts'],
}

/** The known section names in a raw record value. Anything else, including a non-array, is ignored. */
export function parseHiddenSections(raw: unknown): HiddenSection[] {
  if (!Array.isArray(raw)) return []
  const out: HiddenSection[] = []
  for (const v of raw) {
    if (typeof v === 'string' && (HIDDEN_SECTIONS as readonly string[]).includes(v) && !out.includes(v as HiddenSection)) out.push(v as HiddenSection)
  }
  return out
}

/**
 * Returns a copy of `profile` without the keys of every hidden section. `hidden` defaults to the
 * profile's own `hiddenSections` value. The `hiddenSections` key itself never stays in the result.
 */
export function applyHiddenSections<T extends object>(profile: T, hidden?: unknown): Record<string, unknown> {
  const copy = { ...profile } as Record<string, unknown>
  const list = parseHiddenSections(hidden !== undefined ? hidden : copy.hiddenSections)
  delete copy.hiddenSections
  for (const s of list) for (const k of SECTION_KEYS[s]) delete copy[k]
  return copy
}
