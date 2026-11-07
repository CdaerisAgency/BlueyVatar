import { createHash } from 'node:crypto'
import { CID } from 'multiformats/cid'

const SHA2_256 = 0x12

/**
 * Check that blob bytes match their CID before they are cached immutably
 * (spec v9, section 7). atproto blob CIDs use SHA-256.
 */
export function bytesMatchCid(bytes: Uint8Array, cid: string): boolean {
  let parsed: CID
  try {
    parsed = CID.parse(cid)
  } catch {
    return false
  }
  if (parsed.multihash.code !== SHA2_256) return false
  const digest = createHash('sha256').update(bytes).digest()
  return Buffer.compare(digest, Buffer.from(parsed.multihash.digest)) === 0
}
