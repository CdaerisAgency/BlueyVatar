import { describe, expect, it } from 'vitest'
import { consentOpen, rowStatus } from './push-status'
import { CONSENT_WINDOW_MS } from './push-store'

const now = Date.parse('2026-11-14T12:00:00Z')
const started = (agoMs: number) => new Date(now - agoMs)

describe('rowStatus', () => {
  it('is off with no choice, whatever permission the session holds', () => {
    expect(rowStatus({ enabled: false, consentStartedAt: null }, false, now)).toBe('off')
    expect(rowStatus({ enabled: false, consentStartedAt: null }, true, now)).toBe('off')
  })
  it('is on only while the permission is held, and asks to allow again when it is gone', () => {
    expect(rowStatus({ enabled: true, consentStartedAt: null }, true, now)).toBe('on')
    expect(rowStatus({ enabled: true, consentStartedAt: null }, false, now)).toBe('needs_permission')
  })
  it('finishes or reports a declined permission after the permission screen, within the window', () => {
    expect(rowStatus({ enabled: false, consentStartedAt: started(1000) }, true, now)).toBe('finish')
    expect(rowStatus({ enabled: false, consentStartedAt: started(1000) }, false, now)).toBe('declined')
  })
  it('forgets a consent step that was left open too long', () => {
    expect(consentOpen({ consentStartedAt: started(CONSENT_WINDOW_MS - 1) }, now)).toBe(true)
    expect(consentOpen({ consentStartedAt: started(CONSENT_WINDOW_MS) }, now)).toBe(false)
    expect(rowStatus({ enabled: false, consentStartedAt: started(CONSENT_WINDOW_MS + 1) }, true, now)).toBe('off')
  })
})
