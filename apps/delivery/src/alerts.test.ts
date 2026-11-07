import { describe, expect, it, vi } from 'vitest'
import { Notifier } from '@blueyvatar/core/verification'
import { EmailAlertSink, MemoryAlertLedger, UsageAlerts, crossedThresholds, type AlertSink, type UsageAlert } from './alerts.js'

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

describe('EmailAlertSink', () => {
  const alert: UsageAlert = { licenseId: 'L1', threshold: 80, used: 40_000, included: 50_000, period: '2026-11-01' }
  function setup(opts: { prefs?: { usageAlerts: boolean; billingNotices: boolean }; address?: string | null; owner?: string | null; fail?: boolean } = {}) {
    const mail: Array<{ to: string; subject: string; text: string }> = []
    const logged: UsageAlert[] = []
    const dir = { address: async () => (opts.address === undefined ? 'a@example.com' : opts.address), prefs: async () => opts.prefs ?? { usageAlerts: true, billingNotices: true } }
    const sender = { send: async (m: { to: string; subject: string; text: string }) => { if (opts.fail) throw new Error('down'); mail.push(m) } }
    const sink = new EmailAlertSink(new Notifier(sender, dir), async () => (opts.owner === undefined ? 'did:plc:alice' : opts.owner), 'https://blueyvatar.com', { send: async (a) => void logged.push(a) })
    return { mail, logged, sink }
  }

  it('emails the owner with the DID and settings link', async () => {
    const { mail, logged, sink } = setup()
    await sink.send(alert)
    expect(mail).toHaveLength(1)
    expect(mail[0]!.to).toBe('a@example.com')
    expect(mail[0]!.text).toContain('did:plc:alice')
    expect(mail[0]!.text).toContain('/account/notifications')
    expect(logged).toEqual([])
  })
  it('falls back to the console sink with no address, no owner, or a failed send', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const o of [{ address: null }, { owner: null }, { fail: true }]) {
      const { mail, logged, sink } = setup(o)
      await sink.send(alert)
      expect(mail).toEqual([])
      expect(logged).toEqual([alert])
    }
  })
  it('sends nothing when the owner turned usage alerts off', async () => {
    const { mail, logged, sink } = setup({ prefs: { usageAlerts: false, billingNotices: true } })
    await sink.send(alert)
    expect(mail).toEqual([])
    expect(logged).toEqual([])
  })
  it('once per threshold through UsageAlerts, so repeats mail once', async () => {
    const { mail, sink } = setup()
    const alerts = new UsageAlerts(sink, new MemoryAlertLedger(), () => new Date('2026-11-15T00:00:00Z'))
    for (const used of [40_000, 40_001, 40_000]) await alerts.check('L1', 'pro', used)
    expect(mail).toHaveLength(1)
  })
})
