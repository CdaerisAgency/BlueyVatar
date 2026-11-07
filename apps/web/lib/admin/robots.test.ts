import { describe, expect, it } from 'vitest'
import robots from '../../app/robots'
import { STATIC_PAGES } from '../site'
import { BUCKETS } from '../rate-limit'

describe('admin discovery and limits', () => {
  it('robots.txt disallows /admin', () => {
    const rules = robots().rules
    const list = Array.isArray(rules) ? rules : [rules]
    expect(list.some((r) => r.userAgent === '*' && [r.disallow].flat().includes('/admin'))).toBe(true)
  })
  it('the sitemap page list has no admin path', () => {
    expect(STATIC_PAGES.some((p) => p.startsWith('/admin'))).toBe(false)
  })
  it('admin sign-in has failure lockouts and action limits', () => {
    for (const b of ['adminLogin.did', 'adminLogin.ip', 'adminFail.did', 'adminFail.ip', 'adminAction.did', 'adminAction.ip'] as const) expect(BUCKETS[b].limit).toBeGreaterThan(0)
    expect(BUCKETS['adminFail.did'].limit).toBeLessThanOrEqual(5)
  })
})
