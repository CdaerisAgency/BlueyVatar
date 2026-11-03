import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import { bytesMatchCid } from './cid.js'

describe('bytesMatchCid', () => {
  const bytes = new TextEncoder().encode('avatar bytes')
  const cid = CID.createV1(0x55, Digest.create(0x12, createHash('sha256').update(bytes).digest())).toString()
  it('accepts matching bytes', () => expect(bytesMatchCid(bytes, cid)).toBe(true))
  it('rejects other bytes and bad CIDs', () => {
    expect(bytesMatchCid(new TextEncoder().encode('swapped'), cid)).toBe(false)
    expect(bytesMatchCid(bytes, 'not-a-cid')).toBe(false)
  })
})
