import { describe, expect, it } from 'vitest'
import { ownerAvatarUrl, publicDeliveryBase } from './avatar-preview'

const H = '9739039a'.padEnd(64, '0')

describe('owner avatar URL', () => {
  it('points at the delivery host that serves /avatar/{hash}, not the web host', () => {
    const url = ownerAvatarUrl(H, { PUBLIC_DELIVERY_URL: 'https://img.blueyvatar.com/', DELIVERY_URL: 'http://delivery.internal:3001' })
    expect(url).toBe(`https://img.blueyvatar.com/avatar/${H}?s=200`)
    expect(new URL(url).hostname).not.toBe('blueyvatar.com')
  })
  it('falls back to DELIVERY_URL, then to the local default', () => {
    expect(publicDeliveryBase({ DELIVERY_URL: 'http://d:3001' })).toBe('http://d:3001')
    expect(publicDeliveryBase({})).toBe('http://localhost:3001')
  })
})
