import { describe, expect, it } from 'vitest'
import { historyDays, historyPeriods, periodEndOf, periodStartOf } from './index.js'

const NOW = new Date('2026-03-02T10:00:00Z')

describe('usage windows', () => {
  it('starts periods on the first UTC day', () => {
    expect(periodStartOf(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-01')
    expect(periodEndOf('2026-02-01')).toBe('2026-02-28')
    expect(periodEndOf('2028-02-01')).toBe('2028-02-29')
    expect(periodEndOf('2026-12-01')).toBe('2026-12-31')
  })

  it('covers 2 months for Pro, 12 for Business, none for Free', () => {
    expect(historyPeriods('free', NOW)).toEqual([])
    expect(historyPeriods('plus', NOW)).toEqual(['2026-03-01', '2026-02-01'])
    const b = historyPeriods('business', NOW)
    expect(b).toHaveLength(12)
    expect(b[11]).toBe('2025-04-01')
  })

  it('lists 30 UTC days newest first for paid tiers, none for Free', () => {
    expect(historyDays('free', NOW)).toEqual([])
    const d = historyDays('plus', NOW)
    expect(d).toHaveLength(30)
    expect(d[0]).toBe('2026-03-02')
    expect(d[29]).toBe('2026-02-01')
    expect(historyDays('business', NOW)).toEqual(d)
  })
})
