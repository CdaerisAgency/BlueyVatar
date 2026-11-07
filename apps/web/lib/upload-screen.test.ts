import { describe, expect, it } from 'vitest'
import { SCAN_REJECT_MESSAGE, type ContentScanner, type ScanResult } from '@blueyvatar/core'
import { screenWith } from './upload-screen'

const bytes = new Uint8Array([9, 9, 9])
function setup(result: ScanResult, env: { SCAN_FAIL_CLOSED?: string } = {}) {
  const events: unknown[] = []
  const scanner: ContentScanner = { name: 'fake', scan: async () => result }
  return { events, run: () => screenWith({ scanner, env, record: async (e) => void events.push(e) }, 'did:plc:alice', bytes, 'image/png') }
}

describe('screenWith', () => {
  it('lets a clear image through without an event', async () => {
    const t = setup({ status: 'clear' })
    expect(await t.run()).toEqual({ ok: true })
    expect(t.events).toEqual([])
  })
  it('rejects a match with the neutral message and records a restricted event without image data', async () => {
    const t = setup({ status: 'match', service: 'photodna', flags: ['f1'] })
    expect(await t.run()).toEqual({ ok: false, error: SCAN_REJECT_MESSAGE })
    expect(SCAN_REJECT_MESSAGE).toBe("This image was flagged by an automated screening service and can't be uploaded.")
    expect(t.events).toEqual([{ did: 'did:plc:alice', service: 'photodna', outcome: 'match', flags: ['f1'] }])
    expect(JSON.stringify(t.events)).not.toContain('9,9,9')
  })
  it('fails open on an outage by default and closed with SCAN_FAIL_CLOSED', async () => {
    const outage: ScanResult = { status: 'error', service: 'photodna', reason: 'http 503' }
    const open = setup(outage)
    expect(await open.run()).toEqual({ ok: true })
    expect(open.events).toMatchObject([{ outcome: 'outage_allowed' }])
    const closed = setup(outage, { SCAN_FAIL_CLOSED: 'true' })
    expect((await closed.run()).ok).toBe(false)
    expect(closed.events).toMatchObject([{ outcome: 'outage_blocked' }])
  })
})
