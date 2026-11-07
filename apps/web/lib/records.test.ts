import { describe, expect, it } from 'vitest'
import {
  MAX_BLOB_BYTES,
  MAX_LONG_EDGE,
  canAddImage,
  parseCropFields,
  imageLimit,
  isValidTimezone,
  labelValues,
  labelsForRating,
  parseInterests,
  selfLabels,
  readImageSize,
  sniffImageMime,
  validateImageBytes,
  validateNewImage,
  validateProfile,
} from './records'
import { ratingFromLabels } from '@blueyvatar/core'

function pngBytes(w: number, h: number, extra = 0): Uint8Array {
  const b = new Uint8Array(24 + extra)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const v = new DataView(b.buffer)
  v.setUint32(16, w)
  v.setUint32(20, h)
  return b
}
const PNG = pngBytes(100, 100)
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
    const at = pngBytes(100, 100, MAX_BLOB_BYTES - 24)
    expect(validateImageBytes(at)).toMatchObject({ ok: true, value: { mime: 'image/png' } })
    const over = pngBytes(100, 100, MAX_BLOB_BYTES + 1 - 24)
    expect(validateImageBytes(over).ok).toBe(false)
  })
  it('reads PNG and JPEG dimensions', () => {
    expect(readImageSize(pngBytes(300, 120))).toEqual({ width: 300, height: 120 })
    // SOI, APP0 (len 4), SOF0 with height 90 and width 200.
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 90, 0, 200, 1, 1, 0x11, 0])
    expect(readImageSize(jpg)).toEqual({ width: 200, height: 90 })
    expect(readImageSize(JPG)).toBeNull()
  })
  it('rejects images under 80px on either side', () => {
    expect(validateImageBytes(pngBytes(80, 80)).ok).toBe(true)
    expect(validateImageBytes(pngBytes(79, 500))).toMatchObject({ ok: false, error: expect.stringContaining('80 by 80') })
    expect(validateImageBytes(pngBytes(500, 79)).ok).toBe(false)
  })
  it('uses the reference PDS blob limit of 5 MiB', () => {
    expect(MAX_BLOB_BYTES).toBe(5 * 1024 * 1024)
    expect(validateImageBytes(pngBytes(100, 100, MAX_BLOB_BYTES))).toMatchObject({ ok: false, error: expect.stringContaining('5 MB') })
  })
  it('accepts a long edge above 4096 and reports the size, so the server can downscale instead of rejecting', () => {
    expect(MAX_LONG_EDGE).toBe(4096)
    expect(validateImageBytes(pngBytes(8000, 6000))).toMatchObject({ ok: true, value: { width: 8000, height: 6000 } })
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
  it('accepts only #rrggbb for the background color and stores it lowercase', () => {
    expect(validateProfile({ ...blank, backgroundColor: '#1F4E9B' })).toEqual({ ok: true, value: { backgroundColor: '#1f4e9b' } })
    expect(validateProfile({ ...blank, backgroundColor: ' #ffffff ' })).toEqual({ ok: true, value: { backgroundColor: '#ffffff' } })
    expect(validateProfile({ ...blank, backgroundColor: '' })).toEqual({ ok: true, value: {} })
    for (const bad of ['red', '#fff', '#ffffffff', 'ffffff', '#gggggg', 'rgb(0,0,0)', 'url(x)', '#ffffff;x']) {
      expect(validateProfile({ ...blank, backgroundColor: bad }).ok, bad).toBe(false)
    }
  })
  it('enforces lexicon limits', () => {
    expect(validateProfile({ ...blank, pronouns: 'x'.repeat(41) }).ok).toBe(false)
    expect(validateProfile({ ...blank, company: 'x'.repeat(101) }).ok).toBe(false)
    expect(validateProfile({ ...blank, timezone: 'Nope/Nope' }).ok).toBe(false)
  })
})

describe('crop fields', () => {
  it('treats blank fields as no crop', () => {
    expect(parseCropFields({})).toEqual({ ok: true, value: undefined })
    expect(parseCropFields({ cropX: '', cropY: ' ', cropSize: '' })).toEqual({ ok: true, value: undefined })
  })
  it('reads three integers in 1/10000 units', () => {
    expect(parseCropFields({ cropX: '2500', cropY: '0', cropSize: '5000' })).toEqual({ ok: true, value: { x: 2500, y: 0, size: 5000 } })
  })
  it.each([
    [{ cropX: '1', cropY: '2' }],
    [{ cropX: '1.5', cropY: '0', cropSize: '5' }],
    [{ cropX: '-1', cropY: '0', cropSize: '5' }],
    [{ cropX: '0', cropY: '0', cropSize: '0' }],
    [{ cropX: '0', cropY: '0', cropSize: '10001' }],
    [{ cropX: 'a', cropY: '0', cropSize: '5' }],
  ])('rejects %j', (input) => expect(parseCropFields(input)).toMatchObject({ ok: false, error: expect.stringContaining('crop') }))
  it('puts the crop in the new image fields only when given', () => {
    const base = { alt: '', rating: 'g', license: 'personal', isDefault: false }
    expect(validateNewImage(base)).toMatchObject({ ok: true, value: { license: 'personal' } })
    expect((validateNewImage(base) as { value: object }).value).not.toHaveProperty('crop')
    expect(validateNewImage({ ...base, cropX: '1000', cropY: '2000', cropSize: '6000' })).toMatchObject({ ok: true, value: { crop: { x: 1000, y: 2000, size: 6000 } } })
    expect(validateNewImage({ ...base, cropX: '1000' })).toMatchObject({ ok: false })
  })
})
