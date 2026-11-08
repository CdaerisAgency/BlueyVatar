import { describe, expect, it } from 'vitest'
import { describeLinkedEmails, maskDomain, readPrimaryAddress } from './linked-emails'
import type { LinkRow } from './store'

const row = (o: Partial<LinkRow>): LinkRow => ({ emailHash: 'a'.repeat(64), method: 'code', verifiedAt: new Date(0), primary: false, emailDomain: null, ...o })

describe('linked email display', () => {
  it('shows the primary in full and others masked', () => {
    const v = describeLinkedEmails([row({ primary: true, emailDomain: 'cdaeris.com' }), row({ emailHash: 'b'.repeat(64), emailDomain: 'cdaeris.com' }), row({ emailHash: 'c'.repeat(64) })], 'chris@cdaeris.com')
    expect(v.map((x) => [x.text, x.full])).toEqual([['chris@cdaeris.com', true], ['***@cdaeris.com', false], ['Address hidden', false]])
  })
  it('masks the primary when its address cannot be read', () => {
    expect(describeLinkedEmails([row({ primary: true, emailDomain: 'x.test' })], null)[0]).toMatchObject({ text: '***@x.test', full: false })
  })
  it('masks a domain like maskEmail does', () => {
    expect(maskDomain('blueyvatar.com')).toBe('b***.com')
  })
  it('reads the primary address and survives bad data', () => {
    expect(readPrimaryAddress(undefined)).toBeNull()
    expect(readPrimaryAddress('enc', () => 'a@b.test')).toBe('a@b.test')
    expect(readPrimaryAddress('enc', () => { throw new Error('bad') })).toBeNull()
  })
})
