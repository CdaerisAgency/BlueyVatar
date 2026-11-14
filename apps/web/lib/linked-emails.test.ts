import { describe, expect, it } from 'vitest'
import { describeLinkedEmails, maskDomain, readPrimaryAddress } from './linked-emails'
import type { LinkRow } from './store'

const row = (o: Partial<LinkRow>): LinkRow => ({ emailHash: 'a'.repeat(64), method: 'code', verifiedAt: new Date(0), primary: false, emailDomain: null, emailEnc: null, ...o })

describe('linked email display', () => {
  const dec = (e: string) => e.replace(/^v1:/, '')
  it('shows every stored address in full and masks older links, falling back to the notice copy for the primary', () => {
    const v = describeLinkedEmails(
      [
        row({ primary: true, emailDomain: 'cdaeris.com' }),
        row({ emailHash: 'b'.repeat(64), emailDomain: 'cdaeris.com', emailEnc: 'v1:other@cdaeris.com' }),
        row({ emailHash: 'c'.repeat(64), emailDomain: 'x.test' }),
        row({ emailHash: 'd'.repeat(64) }),
      ],
      'chris@cdaeris.com',
      dec,
    )
    expect(v.map((x) => [x.text, x.full])).toEqual([['chris@cdaeris.com', true], ['other@cdaeris.com', true], ['***@x.test', false], ['Address hidden', false]])
  })
  it('masks a link whose stored address cannot be decrypted', () => {
    const v = describeLinkedEmails([row({ emailDomain: 'x.test', emailEnc: 'v1:bad' })], null, () => { throw new Error('bad') })
    expect(v[0]).toMatchObject({ text: '***@x.test', full: false })
  })
  it('masks the primary when its address cannot be read', () => {
    expect(describeLinkedEmails([row({ primary: true, emailDomain: 'x.test' })], null, dec)[0]).toMatchObject({ text: '***@x.test', full: false })
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
