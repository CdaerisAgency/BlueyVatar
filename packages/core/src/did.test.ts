import { describe, expect, it } from 'vitest'
import { DID_RE, isDid } from './did.js'

describe('did', () => {
  it('accepts did:plc and did:web', () => {
    expect(isDid('did:plc:abc123')).toBe(true)
    expect(isDid('did:web:example.com')).toBe(true)
    expect(DID_RE.test('did:web:localhost%3A3000')).toBe(true)
  })
  it('rejects other methods, handles, emails, empty and long bodies, and non-strings', () => {
    expect(isDid('did:key:abc')).toBe(false)
    expect(isDid('bob.bsky.social')).toBe(false)
    expect(isDid('bob@example.com')).toBe(false)
    expect(isDid('did:plc:')).toBe(false)
    expect(isDid(`did:plc:${'a'.repeat(201)}`)).toBe(false)
    expect(isDid(`did:plc:${'a'.repeat(200)}`)).toBe(true)
    expect(isDid(42)).toBe(false)
  })
})
