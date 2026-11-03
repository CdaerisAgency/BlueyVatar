import { describe, expect, it } from 'vitest'
import {
  MAX_BLOB_BYTES,
  canAddImage,
  imageLimit,
  isValidTimezone,
  labelValues,
  labelsForRating,
  parseInterests,
  selfLabels,
  sniffImageMime,
  validateImageBytes,
  validateNewImage,
  validateProfile,
} from './records'
import { ratingFromLabels } from '@blueyvatar/core'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const blank = { jobTitle: '', company: '', location: '', pronouns: '', pronunciation: '', timezone: '', interests: '' }

describe('rating to labels', () => {
  it('maps per spec section 9', () => {
    expect(labelsForRating('g')).toEqual([])
    expect(labelsForRating('pg')).toEqual(['nudity'])
    expect(labelsForRating('r')).toEqual(['sexual'])
    expect(labelsForRating('r', 'graphic-media')).toEqual(['graphic-media'])
    expect(labelsForRating('x')).toEqual(['porn'])
  })
  it('omits labels for G and builds selfLabels otherwise', () => {
    expect(selfLabels('g')).toBeUndefined()
    expect(selfLabels('x')).toEqual({ $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'porn' }] })
  })
  it('round-trips through the core rating reader', () => {
    for (const r of ['g', 'pg', 'r', 'x'] as const) expect(ratingFromLabels(labelValues(selfLabels(r)))).toBe(r)
    expect(ratingFromLabels(labelValues(selfLabels('r', 'graphic-media')))).toBe('r')
  })
  it('tolerates junk labels', () => {
    expect(labelValues(undefined)).toEqual([])
    expect(labelValues({ values: [1, { val: 'nudity' }] })).toEqual(['nudity'])
  })
})

describe('image bytes', () => {
  it('sniffs PNG and JPEG', () => {
    expect(sniffImageMime(PNG)).toBe('image/png')
    expect(sniffImageMime(JPG)).toBe('image/jpeg')
    expect(sniffImageMime(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))).toBeNull()
  })
  it('enforces the size limit exactly', () => {
    const at = new Uint8Array(MAX_BLOB_BYTES)
    at.set(PNG)
    expect(validateImageBytes(at)).toMatchObject({ ok: true, value: { mime: 'image/png' } })
    const over = new Uint8Array(MAX_BLOB_BYTES + 1)
    over.set(PNG)
    expect(validateImageBytes(over).ok).toBe(false)
  })
  it('rejects empty and unsupported files', () => {
    expect(validateImageBytes(new Uint8Array(0)).ok).toBe(false)
    expect(validateImageBytes(new TextEncoder().encode('<svg></svg>')).ok).toBe(false)
  })
})

describe('plan limits', () => {
  it('allows 3 for Free and 20 for Plus', () => {
    expect(imageLimit('free')).toBe(3)
    expect(canAddImage(2, 'free')).toBe(true)
    expect(canAddImage(3, 'free')).toBe(false)
    expect(canAddImage(19, 'plus')).toBe(true)
    expect(canAddImage(20, 'plus')).toBe(false)
  })
})

describe('validateNewImage', () => {
  const base = { alt: ' me ', rating: 'g', license: 'cc-by', isDefault: true }
  it('builds fields', () => {
    expect(validateNewImage(base)).toEqual({ ok: true, value: { alt: 'me', license: 'cc-by', isDefault: true } })
  })
  it('requires an R label choice', () => {
    expect(validateNewImage({ ...base, rating: 'r' }).ok).toBe(false)
    const r = validateNewImage({ ...base, rating: 'r', rLabel: 'graphic-media' })
    expect(r).toMatchObject({ ok: true, value: { labels: { values: [{ val: 'graphic-media' }] } } })
  })
  it('rejects bad rating, license, and long alt', () => {
    expect(validateNewImage({ ...base, rating: 'z' }).ok).toBe(false)
    expect(validateNewImage({ ...base, license: 'mit' }).ok).toBe(false)
    expect(validateNewImage({ ...base, alt: 'a'.repeat(301) }).ok).toBe(false)
    expect(validateNewImage({ ...base, alt: 'a'.repeat(300) }).ok).toBe(true)
  })
  it('counts graphemes, not code units', () => {
    expect(validateNewImage({ ...base, alt: '👩‍👩‍👧‍👦'.repeat(300) }).ok).toBe(false) // over the 3000 byte limit
    expect(validateNewImage({ ...base, alt: '👍🏽'.repeat(200) }).ok).toBe(true) // 200 graphemes, 1600 bytes
  })
})

describe('timezone', () => {
  it('validates IANA names', () => {
    expect(isValidTimezone('America/New_York')).toBe(true)
    expect(isValidTimezone('Europe/Berlin')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })
})

describe('interests', () => {
  it('splits, trims, and dedupes', () => {
    expect(parseInterests('chess, Go\n chess ,,hiking')).toEqual({ ok: true, value: ['chess', 'Go', 'hiking'] })
  })
  it('caps at 20', () => {
    const ok20 = Array.from({ length: 20 }, (_, i) => `i${i}`).join(',')
    expect(parseInterests(ok20).ok).toBe(true)
    expect(parseInterests(`${ok20},extra`).ok).toBe(false)
  })
  it('caps each at 50 graphemes', () => {
    expect(parseInterests('a'.repeat(51)).ok).toBe(false)
  })
})

describe('validateProfile', () => {
  it('omits blanks', () => {
    expect(validateProfile(blank)).toEqual({ ok: true, value: {} })
  })
  it('accepts a full profile', () => {
    const r = validateProfile({ ...blank, jobTitle: 'Dev', timezone: 'Asia/Tokyo', interests: 'a,b', pronouns: 'they/them' })
    expect(r).toEqual({ ok: true, value: { jobTitle: 'Dev', pronouns: 'they/them', timezone: 'Asia/Tokyo', interests: ['a', 'b'] } })
  })
  it('enforces lexicon limits', () => {
    expect(validateProfile({ ...blank, pronouns: 'x'.repeat(41) }).ok).toBe(false)
    expect(validateProfile({ ...blank, company: 'x'.repeat(101) }).ok).toBe(false)
    expect(validateProfile({ ...blank, timezone: 'Nope/Nope' }).ok).toBe(false)
  })
})
