import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@blueyvatar/core/settings'
import { auditSummary, crossPlanWarnings, formChanges, friendlyErrors, parseIntField, submittedValues } from './settings-form'

describe('settings form helpers', () => {
  it('parses grouped digits and refuses junk', () => {
    expect(parseIntField('1,000')).toBe(1000)
    expect(parseIntField('1 000')).toBe(1000)
    expect(parseIntField('1_000')).toBe(1000)
    expect(parseIntField(' 42 ')).toBe(42)
    for (const bad of ['1e3', '-5', '12.5', '', '1,,0', ',1', '99999999999999999999']) expect(parseIntField(bad)).toBeNull()
  })
  it('formChanges reads ints and access checkboxes', () => {
    const f = new FormData()
    f.set('limits.anonymousDaily', '1,500')
    f.set('sizes.free.maxSize', 'abc')
    f.set('embeds.profileAccess.free', 'on')
    f.set('embeds.profileAccess.business', 'on')
    const c = formChanges(f)
    expect(c).toContainEqual({ key: 'limits.anonymousDaily', value: 1500 })
    expect(c).toContainEqual({ key: 'sizes.free.maxSize', value: null })
    expect(c.find((x) => x.key === 'limits.plus.keyedMonthly')).toBeUndefined()
    expect(c.find((x) => x.key === 'embeds.profileAccess')?.value).toEqual({ anonymous: false, free: true, plus: false, business: true })
  })
  it('crossPlanWarnings flags free above plus', () => {
    expect(crossPlanWarnings(DEFAULT_SETTINGS)).toEqual([])
    const s = structuredClone(DEFAULT_SETTINGS)
    s.maxSize.free = 2048
    s.keyedDaily.free = 10_000
    const w = crossPlanWarnings(s)
    expect(w).toHaveLength(2)
    expect(w[0]).toMatch(/free plan maximum image size/i)
    expect(w[1]).toMatch(/daily limit/i)
    s.maxSize.free = 512
    s.maxSize.plus = 2048
    s.maxSize.business = 1024
    expect(crossPlanWarnings(s).some((x) => /Plus plan maximum/.test(x))).toBe(true)
  })
  it('auditSummary formats before and after', () => {
    expect(auditSummary({ key: 'limits.anonymousDaily', before: 100, after: 200 })).toBe('limits.anonymousDaily: 100 → 200')
    expect(auditSummary({ key: 'sizes.free.maxSize', before: 256, after: 'default' })).toBe('sizes.free.maxSize: 256 → default')
    expect(auditSummary({ key: 'embeds.profileAccess', before: { anonymous: false, free: false, plus: true, business: true }, after: { anonymous: true, free: false, plus: false, business: false } }))
      .toBe('embeds.profileAccess: plus, business → anonymous')
    expect(auditSummary({ name: 'over_limit_avatar', before: null, after: 'a'.repeat(64) })).toBe('over_limit_avatar: none → aaaaaaaa')
    expect(auditSummary(null)).toBeNull()
    expect(auditSummary({ foo: 1 })).toBeNull()
  })
})

describe('friendlyErrors and submittedValues', () => {
  it('uses the field label and grouped numbers', () => {
    const e = friendlyErrors({ 'limits.anonymousDaily': 'limits.anonymousDaily must be a whole number', 'embeds.profileAccess': 'x' })
    expect(e['limits.anonymousDaily']).toBe('Anonymous requests per day (per IP): enter a whole number from 50 to 1,000,000.')
    expect(e['embeds.profileAccess']).toMatch(/^Who may use profile embeds/)
  })
  it('keeps what was typed', () => {
    const f = new FormData()
    f.set('limits.anonymousDaily', '1e3')
    f.set('embeds.profileAccess.plus', 'on')
    const v = submittedValues(f)
    expect(v['limits.anonymousDaily']).toBe('1e3')
    expect(v['embeds.profileAccess.plus']).toBe('on')
    expect(v['embeds.profileAccess.free']).toBe('')
  })
})
