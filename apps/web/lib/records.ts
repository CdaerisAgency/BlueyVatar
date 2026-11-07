/**
 * Pure validation and mapping for the record editor (spec sections 5, 9, 11.2).
 * Limits mirror lexicons/com/blueyvatar/*.json.
 */
import { RATINGS, isPlusDid, type Rating } from '@blueyvatar/core'

export const IMAGE_COLLECTION = 'com.blueyvatar.image'
export const PROFILE_COLLECTION = 'com.blueyvatar.profile'
export const SELF_LABELS_TYPE = 'com.atproto.label.defs#selfLabels'

export const MAX_BLOB_BYTES = 1_000_000
export const LICENSES = ['personal', 'cc-by', 'cc-by-nc', 'all-rights-reserved'] as const
export type License = (typeof LICENSES)[number]
export const DEFAULT_LICENSE: License = 'personal'

export const R_LABELS = ['sexual', 'graphic-media'] as const
export type RLabel = (typeof R_LABELS)[number]

/**
 * User plans from spec section 11.2. Plan storage does not exist yet, so everyone is Free,
 * except DIDs listed in the PLUS_DIDS env var (comma list, for testing).
 */
export const PLAN_IMAGE_LIMITS = { free: 3, plus: 20 } as const
export type Plan = keyof typeof PLAN_IMAGE_LIMITS
export const planFor = (did: string): Plan => (isPlusDid(did, process.env.PLUS_DIDS) ? 'plus' : 'free')

export type Check<T> = { ok: true; value: T } | { ok: false; error: string }
const ok = <T>(value: T): Check<T> => ({ ok: true, value })
const fail = (error: string): Check<never> => ({ ok: false, error })

// ---------- text helpers ----------

export function graphemeCount(s: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0
    for (const _ of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)) n++
    return n
  }
  return [...s].length
}

const utf8Length = (s: string): number => new TextEncoder().encode(s).length

function checkText(label: string, raw: string, maxGraphemes: number, maxLength: number): Check<string> {
  const v = raw.trim()
  if (graphemeCount(v) > maxGraphemes) return fail(`${label} can be at most ${maxGraphemes} characters.`)
  if (utf8Length(v) > maxLength) return fail(`${label} is too long.`)
  return ok(v)
}

// ---------- rating and self-labels ----------

/** Spec section 9: G none, PG nudity, R sexual or graphic-media, X porn. */
export function labelsForRating(rating: Rating, rLabel: RLabel = 'sexual'): string[] {
  switch (rating) {
    case 'g':
      return []
    case 'pg':
      return ['nudity']
    case 'r':
      return [rLabel]
    case 'x':
      return ['porn']
  }
}

/** The record's `labels` union, or undefined for G (no label, so the field is omitted). */
export function selfLabels(rating: Rating, rLabel: RLabel = 'sexual') {
  const vals = labelsForRating(rating, rLabel)
  return vals.length === 0 ? undefined : { $type: SELF_LABELS_TYPE, values: vals.map((val) => ({ val })) }
}

/** Read the label values out of a record's `labels` union. */
export function labelValues(labels: unknown): string[] {
  if (!labels || typeof labels !== 'object') return []
  const values = (labels as { values?: unknown }).values
  if (!Array.isArray(values)) return []
  return values.flatMap((v) => (v && typeof v === 'object' && typeof (v as { val?: unknown }).val === 'string' ? [(v as { val: string }).val] : []))
}

export function parseRating(raw: string): Check<Rating> {
  const v = raw.toLowerCase()
  return (RATINGS as readonly string[]).includes(v) ? ok(v as Rating) : fail('Choose a rating: G, PG, R, or X.')
}

export function parseRLabel(raw: string): Check<RLabel> {
  return (R_LABELS as readonly string[]).includes(raw) ? ok(raw as RLabel) : fail('Choose sexual or graphic media for an R rating.')
}

export function parseLicense(raw: string): Check<License> {
  return (LICENSES as readonly string[]).includes(raw) ? ok(raw as License) : fail('Choose a license from the list.')
}

// ---------- image upload ----------

export type ImageMime = 'image/png' | 'image/jpeg'

/** Sniff the real type from magic bytes. The client-supplied type is never trusted. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

export const MIN_IMAGE_PX = 80

/** Read width and height from the PNG IHDR or the first JPEG SOF marker, with no decoder. */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const mime = sniffImageMime(bytes)
  if (mime === 'image/png') {
    if (bytes.length < 24) return null
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (mime === 'image/jpeg') {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]!
      if (marker === 0xff) { i++; continue }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = v.getUint16(i + 2)
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { height: v.getUint16(i + 5), width: v.getUint16(i + 7) }
      i += 2 + len
    }
  }
  return null
}

export const TOO_SMALL_MESSAGE = `The image is smaller than ${MIN_IMAGE_PX} by ${MIN_IMAGE_PX} pixels. Choose a larger image.`

export function validateImageBytes(bytes: Uint8Array): Check<{ mime: ImageMime; size: number }> {
  if (bytes.length === 0) return fail('Choose an image file.')
  if (bytes.length > MAX_BLOB_BYTES) return fail('The image is larger than 1,000,000 bytes. Resize or compress it and try again.')
  const mime = sniffImageMime(bytes)
  if (!mime) return fail('Only PNG and JPEG images are supported.')
  const dim = readImageSize(bytes)
  if (!dim) return fail('The image could not be read. Choose a valid PNG or JPEG.')
  if (Math.min(dim.width, dim.height) < MIN_IMAGE_PX) return fail(TOO_SMALL_MESSAGE)
  return ok({ mime, size: bytes.length })
}

export function validateAlt(raw: string): Check<string> {
  return checkText('Alt text', raw, 300, 3000)
}

export function imageLimit(plan: Plan): number {
  return PLAN_IMAGE_LIMITS[plan]
}

export function canAddImage(count: number, plan: Plan): boolean {
  return count < imageLimit(plan)
}

export function limitMessage(plan: Plan): string {
  return `The ${plan === 'free' ? 'Free' : 'Plus'} plan allows ${imageLimit(plan)} images. Delete one to add another.`
}

export type NewImageInput = {
  alt: string
  rating: string
  rLabel?: string
  license: string
  isDefault: boolean
}

export type NewImageFields = {
  alt?: string
  labels?: ReturnType<typeof selfLabels>
  license: License
  isDefault: boolean
}

/** Validate the non-file fields of the upload form. */
export function validateNewImage(input: NewImageInput): Check<NewImageFields> {
  const alt = validateAlt(input.alt)
  if (!alt.ok) return alt
  const rating = parseRating(input.rating)
  if (!rating.ok) return rating
  let rLabel: RLabel = 'sexual'
  if (rating.value === 'r') {
    const r = parseRLabel(input.rLabel ?? '')
    if (!r.ok) return r
    rLabel = r.value
  }
  const license = parseLicense(input.license)
  if (!license.ok) return license
  const labels = selfLabels(rating.value, rLabel)
  return ok({
    ...(alt.value ? { alt: alt.value } : {}),
    ...(labels ? { labels } : {}),
    license: license.value,
    isDefault: input.isDefault,
  })
}

// ---------- profile ----------

export const MAX_INTERESTS = 20

export type ProfileInput = {
  jobTitle: string
  company: string
  location: string
  pronouns: string
  pronunciation: string
  timezone: string
  interests: string
}

export type ProfileFields = {
  jobTitle?: string
  company?: string
  location?: string
  pronouns?: string
  pronunciation?: string
  timezone?: string
  interests?: string[]
}

/** IANA zone check. Uses Intl.supportedValuesOf when available; UTC is always allowed. */
export function isValidTimezone(tz: string): boolean {
  if (tz.length === 0 || tz.length > 64) return false
  if (tz === 'UTC') return true
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      return intl.supportedValuesOf('timeZone').includes(tz)
    } catch {
      // fall through to the constructor check
    }
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Interests come from one text box: split on commas or new lines, trim, drop blanks and duplicates. */
export function parseInterests(raw: string): Check<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    const c = checkText('Each interest', t, 50, 500)
    if (!c.ok) return c
    seen.add(t.toLowerCase())
    out.push(c.value)
  }
  if (out.length > MAX_INTERESTS) return fail(`Add at most ${MAX_INTERESTS} interests.`)
  return ok(out)
}

/** Blank fields are omitted from the record. */
export function validateProfile(input: ProfileInput): Check<ProfileFields> {
  const out: ProfileFields = {}
  const text: [keyof Pick<ProfileFields, 'jobTitle' | 'company' | 'location' | 'pronouns' | 'pronunciation'>, string, number, number][] = [
    ['jobTitle', 'Job title', 100, 1000],
    ['company', 'Company', 100, 1000],
    ['location', 'Location', 100, 1000],
    ['pronouns', 'Pronouns', 40, 400],
    ['pronunciation', 'Pronunciation', 100, 1000],
  ]
  for (const [key, label, g, b] of text) {
    const c = checkText(label, input[key], g, b)
    if (!c.ok) return c
    if (c.value) out[key] = c.value
  }
  const tz = input.timezone.trim()
  if (tz) {
    if (!isValidTimezone(tz)) return fail('Enter an IANA time zone such as America/New_York.')
    out.timezone = tz
  }
  const interests = parseInterests(input.interests)
  if (!interests.ok) return interests
  if (interests.value.length) out.interests = interests.value
  return ok(out)
}
