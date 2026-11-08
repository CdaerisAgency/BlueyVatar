/**
 * Pure validation and mapping for the record editor (spec sections 5, 9, 11.2).
 * Limits mirror lexicons/com/blueyvatar/*.json.
 */
import {
  MAX_INTERESTS, MAX_INTEREST_CHARS, INTERESTS_BOX_MAX_LENGTH, MAX_LANGUAGES, MAX_SOCIAL_LINKS, MAX_SOCIAL_LABEL_GRAPHEMES, MAX_SOCIAL_URL_LENGTH,
  MAX_WALLETS, MAX_WALLET_CHAIN_GRAPHEMES, MAX_WALLET_ADDRESS_GRAPHEMES, MAX_WALLET_LABEL_GRAPHEMES,
  type ProfileField, type ProfileErrors, type LanguageRow, type SocialLinkRow, type WalletRow,
} from './profile-limits'
import { MAX_BLOB_BYTES, MAX_BLOB_MESSAGE, MAX_LONG_EDGE } from './upload-limits'
import { ENTITLEMENTS, RATINGS, isPlusDid, normalizeBackgroundColor, normalizeLanguageTag, parseCrop, type CropParams, type Rating } from '@blueyvatar/core'

export const IMAGE_COLLECTION = 'com.blueyvatar.image'
export const PROFILE_COLLECTION = 'com.blueyvatar.profile'
export const SELF_LABELS_TYPE = 'com.atproto.label.defs#selfLabels'

export { MAX_BLOB_BYTES, MAX_BLOB_MESSAGE, MAX_LONG_EDGE }

export const R_LABELS = ['sexual', 'graphic-media'] as const
export type RLabel = (typeof R_LABELS)[number]

/**
 * User plans from spec section 11.2. Plan storage does not exist yet, so everyone is Free,
 * except DIDs listed in the PLUS_DIDS env var (comma list, for testing).
 */
export const PLAN_IMAGE_LIMITS = { free: ENTITLEMENTS.free.maxImages, plus: ENTITLEMENTS.plus.maxImages }
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

/** Checks the type, the byte cap, and the 80 pixel minimum. A long edge above MAX_LONG_EDGE is not an error: the server downscales it (lib/server-resize.ts). */
export function validateImageBytes(bytes: Uint8Array): Check<{ mime: ImageMime; size: number; width: number; height: number }> {
  if (bytes.length === 0) return fail('Choose an image file.')
  if (bytes.length > MAX_BLOB_BYTES) return fail(MAX_BLOB_MESSAGE)
  const mime = sniffImageMime(bytes)
  if (!mime) return fail('Only PNG and JPEG images are supported.')
  const dim = readImageSize(bytes)
  if (!dim) return fail('The image could not be read. Choose a valid PNG or JPEG.')
  if (Math.min(dim.width, dim.height) < MIN_IMAGE_PX) return fail(TOO_SMALL_MESSAGE)
  return ok({ mime, size: bytes.length, width: dim.width, height: dim.height })
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

/** The three crop form fields (integers in 1/10000 of the image, see CROP_SCALE). All blank means no crop, so delivery centers. */
export type CropInput = { cropX?: string; cropY?: string; cropSize?: string }

export function parseCropFields(input: CropInput): Check<CropParams | undefined> {
  const raw = [input.cropX, input.cropY, input.cropSize].map((v) => (v ?? '').trim())
  if (raw.every((v) => v === '')) return ok(undefined)
  const crop = raw.every((v) => /^\d{1,5}$/.test(v)) ? parseCrop({ x: Number(raw[0]), y: Number(raw[1]), size: Number(raw[2]) }) : null
  return crop ? ok(crop) : fail('The crop could not be read. Adjust it and try again.')
}

export type NewImageInput = CropInput & {
  alt: string
  rating: string
  rLabel?: string
  isDefault: boolean
}

export type NewImageFields = {
  alt?: string
  /** Square region of the full original to show. Absent means the center crop. */
  crop?: CropParams
  labels?: ReturnType<typeof selfLabels>
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
  const crop = parseCropFields(input)
  if (!crop.ok) return crop
  const labels = selfLabels(rating.value, rLabel)
  return ok({
    ...(alt.value ? { alt: alt.value } : {}),
    ...(crop.value ? { crop: crop.value } : {}),
    ...(labels ? { labels } : {}),
    isDefault: input.isDefault,
  })
}

// ---------- profile ----------

export { MAX_INTERESTS, MAX_INTEREST_CHARS, INTERESTS_BOX_MAX_LENGTH, type ProfileField, type ProfileErrors }

export type ProfileInput = {
  jobTitle: string
  company: string
  location: string
  pronouns: string
  pronunciation: string
  timezone: string
  interests: string
  /** `#rrggbb`, or blank to clear. */
  backgroundColor?: string
  /** Row lists. Omitted lists leave the record without that field. */
  languages?: LanguageRow[]
  socialLinks?: SocialLinkRow[]
  wallets?: WalletRow[]
}

export type ProfileFields = {
  jobTitle?: string
  company?: string
  location?: string
  pronouns?: string
  pronunciation?: string
  timezone?: string
  interests?: string[]
  backgroundColor?: string
  languages?: { tag: string; primary?: boolean }[]
  socialLinks?: { label?: string; url: string }[]
  wallets?: { chain: string; address: string; label?: string; visible: boolean }[]
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
    const c = checkText('Each interest', t, MAX_INTEREST_CHARS, 500)
    if (!c.ok) return c
    seen.add(t.toLowerCase())
    out.push(c.value)
  }
  if (out.length > MAX_INTERESTS) return fail(`Add at most ${MAX_INTERESTS} interests.`)
  return ok(out)
}

/** Checks every field and reports all problems at once. Blank fields are omitted from the record. */
export function validateProfileAll(input: ProfileInput): { ok: true; value: ProfileFields } | { ok: false; errors: ProfileErrors } {
  const out: ProfileFields = {}
  const errors: ProfileErrors = {}
  const text: [keyof Pick<ProfileFields, 'jobTitle' | 'company' | 'location' | 'pronouns' | 'pronunciation'>, string, number, number][] = [
    ['jobTitle', 'Job title', 100, 1000],
    ['company', 'Company', 100, 1000],
    ['location', 'Location', 100, 1000],
    ['pronouns', 'Pronouns', 40, 400],
    ['pronunciation', 'Pronunciation', 100, 1000],
  ]
  for (const [key, label, g, b] of text) {
    const c = checkText(label, input[key], g, b)
    if (!c.ok) errors[key] = c.error
    else if (c.value) out[key] = c.value
  }
  const tz = input.timezone.trim()
  if (tz) {
    if (!isValidTimezone(tz)) errors.timezone = 'Choose a time zone from the list, such as America/New_York.'
    else out.timezone = tz
  }
  const interests = parseInterests(input.interests)
  if (!interests.ok) errors.interests = interests.error
  else if (interests.value.length) out.interests = interests.value
  const color = (input.backgroundColor ?? '').trim()
  if (color) {
    // Strict #rrggbb only. Names, short hex, and rgb() are refused.
    const normalized = normalizeBackgroundColor(color)
    if (!normalized) errors.backgroundColor = 'Use a color like #3366cc.'
    else out.backgroundColor = normalized
  }
  checkRows(input, out, errors)
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: out }
}

const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/u
const CONTROL_OR_SPACE = /[\s\p{Cc}\p{Cf}\u2028\u2029]/u
const blank = (...v: string[]) => v.every((x) => x.trim() === '')

/** Languages, social links, and wallets. Fully blank rows are dropped. */
function checkRows(input: ProfileInput, out: ProfileFields, errors: ProfileErrors): void {
  const langs: NonNullable<ProfileFields['languages']> = []
  const rows = (input.languages ?? []).map((r, idx) => ({ r, idx })).filter(({ r }) => !blank(r.tag))
  if (rows.length > MAX_LANGUAGES) errors.languages = `Add at most ${MAX_LANGUAGES} languages.`
  else {
    rows.forEach(({ r, idx: i }) => {
      const tag = normalizeLanguageTag(r.tag)
      if (!tag) errors[`languages.${i}.tag`] = `Language ${i + 1}: use a language tag such as en, es, or pt-BR.`
      else if (langs.some((l) => l.tag === tag)) errors[`languages.${i}.tag`] = `Language ${i + 1}: ${tag} is already in the list.`
      else langs.push({ tag, ...(r.primary ? { primary: true } : {}) })
    })
    // One primary language at most: the first marked row wins.
    let seen = false
    for (const l of langs) {
      if (l.primary) {
        if (seen) delete l.primary
        seen = true
      }
    }
    if (langs.length) out.languages = langs
  }

  const links: NonNullable<ProfileFields['socialLinks']> = []
  const lrows = (input.socialLinks ?? []).map((r, idx) => ({ r, idx })).filter(({ r }) => !blank(r.label, r.url))
  if (lrows.length > MAX_SOCIAL_LINKS) errors.socialLinks = `Add at most ${MAX_SOCIAL_LINKS} links.`
  else {
    lrows.forEach(({ r, idx: i }) => {
      const n = i + 1
      const label = r.label.trim()
      if (graphemeCount(label) > MAX_SOCIAL_LABEL_GRAPHEMES) errors[`socialLinks.${i}.label`] = `Link ${n}: the label can be at most ${MAX_SOCIAL_LABEL_GRAPHEMES} characters.`
      const raw = r.url.trim()
      let u: URL | null = null
      try {
        u = raw.length <= MAX_SOCIAL_URL_LENGTH ? new URL(raw) : null
      } catch {
        u = null
      }
      if (!u || u.protocol !== 'https:' || u.username || u.password || !u.hostname || raw.length > MAX_SOCIAL_URL_LENGTH) {
        errors[`socialLinks.${i}.url`] = `Link ${n}: enter a full address that starts with https://.`
      } else if (!errors[`socialLinks.${i}.label`]) {
        links.push({ ...(label ? { label } : {}), url: u.href })
      }
    })
    if (links.length) out.socialLinks = links
  }

  const wallets: NonNullable<ProfileFields['wallets']> = []
  const wrows = (input.wallets ?? []).map((r, idx) => ({ r, idx })).filter(({ r }) => !blank(r.chain, r.address, r.label))
  if (wrows.length > MAX_WALLETS) errors.wallets = `Add at most ${MAX_WALLETS} wallets.`
  else {
    wrows.forEach(({ r, idx: i }) => {
      const n = i + 1
      const chain = r.chain.trim()
      const address = r.address.trim()
      const label = r.label.trim()
      let bad = false
      if (!chain || graphemeCount(chain) > MAX_WALLET_CHAIN_GRAPHEMES || CONTROL.test(chain)) {
        errors[`wallets.${i}.chain`] = `Wallet ${n}: enter a chain name of up to ${MAX_WALLET_CHAIN_GRAPHEMES} characters, such as Bitcoin.`
        bad = true
      }
      if (!address || graphemeCount(address) > MAX_WALLET_ADDRESS_GRAPHEMES || CONTROL_OR_SPACE.test(address)) {
        errors[`wallets.${i}.address`] = `Wallet ${n}: enter an address of up to ${MAX_WALLET_ADDRESS_GRAPHEMES} characters with no spaces.`
        bad = true
      }
      if (graphemeCount(label) > MAX_WALLET_LABEL_GRAPHEMES || CONTROL.test(label)) {
        errors[`wallets.${i}.label`] = `Wallet ${n}: the label can be at most ${MAX_WALLET_LABEL_GRAPHEMES} characters.`
        bad = true
      }
      if (!bad) wallets.push({ chain, address, ...(label ? { label } : {}), visible: r.visible === true })
    })
    if (wallets.length) out.wallets = wallets
  }
}

/** First problem only, for callers that show a single message. */
export function validateProfile(input: ProfileInput): Check<ProfileFields> {
  const r = validateProfileAll(input)
  if (r.ok) return ok(r.value)
  return fail(Object.values(r.errors)[0] as string)
}
