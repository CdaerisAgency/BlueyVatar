import { describe, expect, it, vi } from 'vitest'
import { encryptJson } from './token-crypto.js'
import {
  keyRevokedNotice, Notifier, reportOutcomeNotice, noticeAllowed, paymentFailedNotice, pgNoticeDirectory, usageNotice,
  type NoticeDirectory, type NoticePrefs,
} from './notices.js'

const DID = 'did:plc:alice'
const URL = 'https://blueyvatar.com'

describe('templates', () => {
  const all = [
    usageNotice({ did: DID, threshold: 80, used: 40_000, included: 50_000, period: '2026-11-01', publicUrl: URL }),
    usageNotice({ did: DID, threshold: 100, used: 50_000, included: 50_000, period: '2026-11-01', publicUrl: URL + '/' }),
    paymentFailedNotice({ did: DID, graceEnds: new Date('2026-11-08T00:00:00Z'), publicUrl: URL }),
    keyRevokedNotice({ did: DID, prefix: 'bv_pub_ab12', label: 'site', publicUrl: URL }),
  ]
  it('carry the DID and the preferences link, in plain text', () => {
    for (const n of all) {
      expect(n.text).toContain(`Account: ${DID}`)
      expect(n.text).toContain('https://blueyvatar.com/account/notifications')
      expect(n.text).not.toMatch(/<img|<a |https?:\/\/[^\s]*\?(utm|track)/i)
      expect(n.text).not.toContain('//account')
      expect(n.text + n.subject).not.toContain(String.fromCharCode(0x2014))
    }
  })
  it('say what happened', () => {
    expect(all[0]!.text).toContain('80 percent')
    expect(all[0]!.text).toContain('40,000 of 50,000')
    expect(all[1]!.subject).toContain('100 percent')
    expect(all[2]!.text).toContain('2026-11-08')
    expect(all[3]!.text).toContain('site (bv_pub_ab12)')
    expect(all[3]!.text).toContain('always sent')
  })
})

describe('Notifier', () => {
  const dir = (prefs: NoticePrefs, address: string | null = 'a@example.com'): NoticeDirectory => ({ address: async () => address, prefs: async () => prefs })
  const on = { usageAlerts: true, billingNotices: true }
  const msg = { subject: 's', text: 't' }
  function setup(d: NoticeDirectory) {
    const sent: Array<{ to: string; subject: string }> = []
    return { sent, n: new Notifier({ send: async (m) => void sent.push(m) }, d) }
  }

  it('honors preferences but never switches off security notices', async () => {
    const off = { usageAlerts: false, billingNotices: false }
    expect(noticeAllowed(off, 'usage')).toBe(false)
    expect(noticeAllowed(off, 'billing')).toBe(false)
    expect(noticeAllowed(off, 'security')).toBe(true)
    const { sent, n } = setup(dir(off))
    expect(await n.send(DID, 'usage', msg)).toBe('off')
    expect(await n.send(DID, 'billing', msg)).toBe('off')
    expect(await n.send(DID, 'security', msg)).toBe('sent')
    expect(sent).toHaveLength(1)
  })
  it('sends to the stored address', async () => {
    const { sent, n } = setup(dir(on))
    expect(await n.send(DID, 'usage', msg)).toBe('sent')
    expect(sent[0]).toMatchObject({ to: 'a@example.com', subject: 's' })
  })
  it('reports a missing address and a sender failure without throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await setup(dir(on, null)).n.send(DID, 'billing', msg)).toBe('no_address')
    const bad = new Notifier({ send: async () => { throw new Error('boom') } }, dir(on))
    expect(await bad.send(DID, 'billing', msg)).toBe('failed')
  })
})

describe('pgNoticeDirectory', () => {
  const key = Buffer.alloc(32, 7)
  it('decrypts the address and defaults preferences to on', async () => {
    const q = vi.fn(async (sql: string) =>
      sql.includes('notice_emails') ? { rows: [{ email_enc: encryptJson('a@example.com', key) }] } : { rows: [] },
    )
    const d = pgNoticeDirectory({ query: q }, key)
    expect(await d.address(DID)).toBe('a@example.com')
    expect(await d.prefs(DID)).toEqual({ usageAlerts: true, billingNotices: true })
  })
  it('returns null without a row', async () => {
    expect(await pgNoticeDirectory({ query: async () => ({ rows: [] }) }, key).address(DID)).toBeNull()
  })
})

describe('reportOutcomeNotice', () => {
  it('is one short plain message with no account frame and no dashes', () => {
    const a = reportOutcomeNotice({ reportId: 7, outcome: 'actioned', publicUrl: URL + '/' })
    const d = reportOutcomeNotice({ reportId: 8, outcome: 'dismissed', publicUrl: URL })
    expect(a.subject).toContain('#7')
    expect(a.text).toContain('took action')
    expect(d.text).toContain('did not take action')
    expect(a.text).toContain('https://blueyvatar.com/policy')
    for (const n of [a, d]) {
      expect(n.text).not.toContain('Account:')
      expect(n.text + n.subject).not.toContain(String.fromCharCode(0x2014))
    }
  })
})
