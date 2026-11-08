import { describe, expect, it } from 'vitest'
import { addOneYear, asExpiryChoice, daysLeft, DEFAULT_EXPIRY, expiryFor, isExpired } from './key-expiry'

const T = new Date('2026-11-08T12:00:00.000Z')
const DAY = 86_400_000

describe('key expiry date math', () => {
  it('defaults to one year', () => expect(DEFAULT_EXPIRY).toBe('1y'))
  it('adds 30 and 90 days exactly', () => {
    expect(expiryFor('30d', T)!.getTime()).toBe(T.getTime() + 30 * DAY)
    expect(expiryFor('90d', T)!.toISOString()).toBe('2027-02-06T12:00:00.000Z')
  })
  it('adds one calendar year, and never for "never"', () => {
    expect(expiryFor('1y', T)!.toISOString()).toBe('2027-11-08T12:00:00.000Z')
    expect(expiryFor('never', T)).toBeNull()
  })
  it('moves Feb 29 to Feb 28 in a non-leap year', () => {
    expect(addOneYear(new Date('2028-02-29T00:00:00Z')).toISOString()).toBe('2029-02-28T00:00:00.000Z')
    expect(addOneYear(new Date('2027-12-31T23:59:59Z')).toISOString()).toBe('2028-12-31T23:59:59.000Z')
  })
  it('treats the expiry instant as expired and null as never', () => {
    expect(isExpired(null, T)).toBe(false)
    expect(isExpired(new Date(T.getTime() + 1), T)).toBe(false)
    expect(isExpired(T, T)).toBe(true)
    expect(isExpired(new Date(T.getTime() - 1), T)).toBe(true)
  })
  it('counts days left, rounded up and never negative', () => {
    expect(daysLeft(null, T)).toBeNull()
    expect(daysLeft(new Date(T.getTime() + 1), T)).toBe(1)
    expect(daysLeft(new Date(T.getTime() + 3 * DAY), T)).toBe(3)
    expect(daysLeft(new Date(T.getTime() - DAY), T)).toBe(0)
  })
  it('accepts only the four choices', () => {
    expect(asExpiryChoice('90d')).toBe('90d')
    expect(asExpiryChoice('custom')).toBeNull()
    expect(asExpiryChoice(null)).toBeNull()
  })
})
