import { describe, expect, it } from 'vitest'
import { MemoryAlertLedger, UsageAlerts, crossedThresholds, type AlertSink, type UsageAlert } from './alerts.js'

describe('crossedThresholds', () => {
  it('fires at 80 and 100 percent', () => {
    expect(crossedThresholds(78, 79, 100)).toEqual([])
    expect(crossedThresholds(79, 80, 100)).toEqual([80])
    expect(crossedThresholds(99, 100, 100)).toEqual([100])
    expect(crossedThresholds(100, 101, 100)).toEqual([])
    expect(crossedThresholds(50, 150, 100)).toEqual([80, 100])
  })
  it('ignores licenses with no included monthly volume', () => {
    expect(crossedThresholds(0, 5, null)).toEqual([])
    expect(crossedThresholds(0, 5, 0)).toEqual([])
  })
})

describe('UsageAlerts', () => {
  function setup() {
    const sent: UsageAlert[] = []
    const sink: AlertSink = { send: async (a) => { sent.push(a) } }
    return { sent, alerts: new UsageAlerts(sink, new MemoryAlertLedger(), () => new Date('2026-11-15T00:00:00Z')) }
  }

  it('fires each threshold once per period', async () => {
    const { sent, alerts } = setup()
    for (const used of [39_999, 40_000, 40_001, 49_999, 50_000, 50_001, 50_000]) await alerts.check('L1', 'pro', used)
    expect(sent.map((a) => a.threshold)).toEqual([80, 100])
    expect(sent[0]).toMatchObject({ licenseId: 'L1', included: 50_000, period: '2026-11-01' })
  })

  it('skips tiers without a monthly allowance', async () => {
    const { sent, alerts } = setup()
    await alerts.check('F1', 'free', 5_000)
    await alerts.check('E1', 'enterprise', 5_000_000)
    expect(sent).toEqual([])
  })
})
