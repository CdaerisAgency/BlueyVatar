import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@blueyvatar/core/settings'
import { planBodies } from './public'

describe('plan copy', () => {
  it('matches the shipped wording at the defaults', () => {
    const b = planBodies(DEFAULT_SETTINGS)
    expect(b.free).toContain('1,000 requests a day')
    expect(b.plus).toContain('50,000 requests a month')
    expect(b.business).toContain('1 million requests a month')
  })
  it('uses settings', () => {
    const s = structuredClone(DEFAULT_SETTINGS)
    s.keyedMonthly.plus = 75_000
    s.keyedMonthly.business = 2_500_000
    s.keyedDaily.free = 2_000
    const b = planBodies(s)
    expect(b.plus).toContain('75,000 requests a month')
    expect(b.business).toContain('2.5 million requests a month')
    expect(b.free).toContain('2,000 requests a day')
  })
})
