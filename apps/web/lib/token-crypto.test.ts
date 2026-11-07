import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assertTokenKey, decryptJson, encryptJson, parseKey } from './token-crypto'

const key = randomBytes(32)
const payload = { tokenSet: { access_token: 'secret-at', refresh_token: 'secret-rt' }, dpopJwk: { d: 'x' } }

describe('token-crypto', () => {
  it('round trips and never stores plaintext', () => {
    const s = encryptJson(payload, key)
    expect(s).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/)
    expect(s).not.toContain('secret-at')
    expect(decryptJson(s, key)).toEqual(payload)
    expect(encryptJson(payload, key)).not.toBe(s)
  })
  it('rejects tampered ciphertext, tag, and wrong key', () => {
    const [v, iv, tag, ct] = encryptJson(payload, key).split(':') as [string, string, string, string]
    const flip = (b: string) => { const x = Buffer.from(b, 'base64'); x[0] = (x[0] ?? 0) ^ 1; return x.toString('base64') }
    expect(() => decryptJson([v, iv, tag, flip(ct)].join(':'), key)).toThrow()
    expect(() => decryptJson([v, iv, flip(tag), ct].join(':'), key)).toThrow()
    expect(() => decryptJson(encryptJson(payload, key), randomBytes(32))).toThrow()
  })
  it('reads legacy plaintext', () => {
    expect(decryptJson(JSON.stringify(payload), key)).toEqual(payload)
    expect(decryptJson(payload, key)).toEqual(payload)
  })
  it('accepts base64 and hex keys, rejects bad lengths', () => {
    expect(parseKey(key.toString('base64'))).toEqual(key)
    expect(parseKey(key.toString('hex'))).toEqual(key)
    expect(() => parseKey('short')).toThrow()
  })
  it('fails fast in production without a key', () => {
    expect(() => assertTokenKey({ NODE_ENV: 'production' })).toThrow(/TOKEN_ENCRYPTION_KEY/)
    expect(() => assertTokenKey({ NODE_ENV: 'production', TOKEN_ENCRYPTION_KEY: key.toString('base64') })).not.toThrow()
  })
})
