import type { StoredImage } from '../repo'

/** A 24-byte PNG header that declares `w` by `h` pixels, plus `extra` zero bytes. Enough for size checks, not decodable. */
export function pngBytes(w: number, h: number, extra = 0): Uint8Array {
  const b = new Uint8Array(24 + extra)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const v = new DataView(b.buffer)
  v.setUint32(16, w)
  v.setUint32(20, h)
  return b
}

export const DID = 'did:plc:alice'

/** A stored image record owned by DID. */
export const img = (rkey: string, extra: Partial<StoredImage['value']> = {}): StoredImage => ({
  uri: `at://${DID}/com.blueyvatar.image/${rkey}`, cid: `cid-${rkey}`, rkey,
  value: { image: { $type: 'blob', ref: { $link: `blob-${rkey}` }, mimeType: 'image/png', size: 1 }, createdAt: '2026-01-01T00:00:00Z', ...extra },
})

export const SECRET = 'whsec_test_secret'
/** Fake Stripe settings. `plusPrices` is the comma list for STRIPE_PRICE_PLUS. */
export const billingEnv = (plusPrices: string) => ({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_BUSINESS: 'price_biz', STRIPE_PRICE_PLUS: plusPrices })
export const DAY = 86_400_000
export const T0 = Date.parse('2026-11-01T00:00:00Z')
export const sec = (ms: number) => Math.floor(ms / 1000)
