import { describe, expect, it } from 'vitest'
import { canViewChildSafety, citePolicy, DEFAULT_SLA_HOURS, deriveSeverity, formatSla, policyList, slaDueAt, slaHours, slaState } from './config.js'
import { digestIsQuiet, formatDigest, type Digest } from './digest.js'

describe('severity', () => {
  it('derives from report category and scanner or label source', () => {
    expect(deriveSeverity('report', 'child_safety')).toBe('critical')
    expect(deriveSeverity('scanner', 'csam')).toBe('critical')
    expect(deriveSeverity('label', 'child_safety')).toBe('critical')
    expect(deriveSeverity('report', 'illegal')).toBe('high')
    expect(deriveSeverity('report', 'harassment')).toBe('moderate')
    expect(deriveSeverity('report', 'spam')).toBe('low')
    expect(deriveSeverity('report', 'unheard-of')).toBe('low')
    expect(deriveSeverity('scanner', 'explicit')).toBe('high')
    expect(deriveSeverity('scanner', 'other')).toBe('moderate')
    expect(deriveSeverity('label', 'porn')).toBe('high')
    expect(deriveSeverity('label', '!takedown')).toBe('high')
    expect(deriveSeverity('label', 'spoiler')).toBe('moderate')
    expect(deriveSeverity('appeal', 'appeal')).toBe('moderate')
  })
})

describe('SLA', () => {
  it('is configurable and ignores bad entries', () => {
    expect(slaHours({})).toEqual(DEFAULT_SLA_HOURS)
    expect(DEFAULT_SLA_HOURS).toEqual({ critical: 72, high: 72, moderate: 72, low: 72 })
    expect(slaHours({ MODERATION_SLA_HOURS: 'critical=1, high=12,bogus=3,low=-4,moderate=abc' })).toEqual({ ...DEFAULT_SLA_HOURS, critical: 1, high: 12 })
  })
  it('computes due time, breach, and a readable timer', () => {
    const opened = new Date('2026-11-07T00:00:00Z')
    const sla = slaHours({ MODERATION_SLA_HOURS: 'critical=4' })
    expect(slaDueAt(opened, 'critical', sla).toISOString()).toBe('2026-11-07T04:00:00.000Z')
    const open = slaState(opened, 'critical', sla, new Date('2026-11-07T01:30:00Z'))
    expect(open.breached).toBe(false)
    expect(formatSla(open.msLeft)).toBe('2h 30m left')
    const late = slaState(opened, 'critical', sla, new Date('2026-11-07T06:05:00Z'))
    expect(late.breached).toBe(true)
    expect(formatSla(late.msLeft)).toBe('overdue by 2h 5m')
  })
})

describe('policies and roles', () => {
  it('cites only configured policies', () => {
    expect(citePolicy('copyright', {})?.label).toMatch(/Copyright/)
    expect(citePolicy('made-up', {})).toBeNull()
    expect(citePolicy('', {})).toBeNull()
    const env = { MODERATION_POLICIES: 'tos-1=Terms section 1; bad id=x; tos-2=Terms section 2' }
    expect(policyList(env).map((p) => p.id)).toEqual(['tos-1', 'tos-2'])
    expect(citePolicy('copyright', env)).toBeNull()
  })
  it('restricts child safety only when a list is set', () => {
    expect(canViewChildSafety('did:plc:a', {})).toBe(true)
    expect(canViewChildSafety('did:plc:a', { MODERATION_CHILD_SAFETY_DIDS: 'did:plc:b did:plc:c' })).toBe(false)
    expect(canViewChildSafety('did:plc:b', { MODERATION_CHILD_SAFETY_DIDS: 'did:plc:b did:plc:c' })).toBe(true)
  })
})

describe('digest text', () => {
  const zero: Digest = {
    since: new Date('2026-11-06T13:00:00Z'), until: new Date('2026-11-07T13:00:00Z'), newReports: [], slaBreaches: 0, oldestOpen: null, openCases: 0,
    rejections: [], outageAllowed: 0, labelCases: 0, escalated: 0, appeals: 0, childSafetyOpen: 0,
  }
  const busy: Digest = {
    ...zero, newReports: [{ category: 'spam', count: 3 }, { category: 'illegal', count: 1 }], slaBreaches: 2, openCases: 5,
    oldestOpen: { id: 12, severity: 'high', ageHours: 30 }, rejections: [{ service: 'photodna', reason: 'match', count: 4 }], outageAllowed: 2, labelCases: 2, escalated: 1, appeals: 3, childSafetyOpen: 1,
  }
  it('is quiet only when every figure is zero', () => {
    expect(digestIsQuiet(zero)).toBe(true)
    expect(digestIsQuiet({ ...zero, appeals: 1 })).toBe(false)
    expect(digestIsQuiet({ ...zero, outageAllowed: 1 })).toBe(false)
    expect(digestIsQuiet({ ...zero, childSafetyOpen: 1 })).toBe(true)
  })
  it('has counts, the Cloudflare note, and a portal link, and nothing identifying', () => {
    const { subject, text } = formatDigest(busy, 'https://blueyvatar.com/')
    expect(subject).toContain('4 new reports')
    expect(subject).toContain('2 past SLA')
    for (const part of ['spam: 3', 'illegal: 1', 'SLA breaches (open and past due): 2', 'Oldest open case: #12, High, open 30 hours', 'photodna, match: 4', 'Uploads allowed while the scanner was down: 2',
      'Cases opened by labels: 2', 'Escalations waiting: 1', 'Appeals waiting: 3', 'https://dash.cloudflare.com/', 'https://blueyvatar.com/admin']) expect(text).toContain(part)
    expect(text).not.toMatch(/did:|bafy|<img/)
    expect(text + subject).not.toContain(String.fromCharCode(0x2014))
  })
})
