import type { Hono } from 'hono'
import { ABSOLUTE_MAX_SIZE, CANONICAL_QUALITY, IMMUTABLE_CACHE_CONTROL, imagePath, scopeExpired, verifyImageSig, type ImageFormat, WARM_HEADER } from '@blueyvatar/core'
import { isRestricted, type Ctx } from '../context.js'
import { fail, overloaded } from '../http.js'
import { secretsEqual } from '../origin.js'
import { BlobError } from '../blob.js'
import { ResizeBusyError } from '../resize.js'
import { labelBlocksBlob } from '../label-block.js'

const IMG_FILE = /^(\d{1,4})(?:-q(\d{1,3}))?\.(png|jpeg|webp)$/

export function mountImg(app: Hono, ctx: Ctx): void {
  const { deps, logger, metrics } = ctx

  // Immutable resized image. Cached by Cloudflare by file extension (spec section 14.1).
  // Only paths signed by the redirect routes are served (issues #68 and #72). Cloudflare's default
  // cache key is the full URL including the query string, so the origin sends every signed but
  // non-canonical request (off-ladder size, other quality, query string, other DID encoding) to
  // the one canonical signed URL for its variant and scope. That keeps one cache entry per
  // variant and lets the indexer purge exactly the URLs that can exist. Redirecting is cheaper
  // than a resize.
  app.get('/img/:did/:cid/:sig/:file', async (c) => {
    const did = decodeURIComponent(c.req.param('did'))
    const cid = c.req.param('cid')
    const file = c.req.param('file')
    const m = IMG_FILE.exec(file)
    if (!m || !/^[a-z0-9]{10,100}$/.test(cid)) return fail(c, 404, 'not_found', 'Unknown image')
    const size = Number(m[1])
    const quality = m[2] ? Number(m[2]) : undefined
    const format = m[3] as ImageFormat
    if (size < 1 || size > ABSOLUTE_MAX_SIZE) return fail(c, 404, 'invalid_size', 'Size must be from 1 to 2048')
    if (quality !== undefined && (quality < 1 || quality > 100)) return fail(c, 404, 'invalid_quality', 'Quality must be from 1 to 100')
    // The signature covers the file name as requested, so an edited size or quality fails here
    // before any redirect; a non-canonical path only reaches the redirect when it was signed.
    const scope = verifyImageSig(deps.imgSigningSecret, did, cid, file, c.req.param('sig'))
    if (scope === null) return fail(c, 403, 'invalid_signature', 'Image path is not signed for this service')
    if (scope && scopeExpired(scope, deps.now?.())) return fail(c, 403, 'signature_expired', 'Image path has expired; fetch the avatar again')
    const canonical = imagePath(deps.imgSigningSecret, did, cid, size, format, quality, scope)
    const url = new URL(c.req.url)
    if (url.search !== '' || url.pathname !== canonical) {
      c.header('cache-control', 'public, max-age=3600')
      return c.redirect(canonical, 302)
    }
    if (!(await deps.index.isRepoActive(did)) || (await deps.index.isBlocked(did, cid)) || (await labelBlocksBlob(deps.index, did, cid))) {
      return fail(c, 404, 'not_found', 'Image unavailable')
    }
    // A public URL issued before the user switched to keyed only or a domain allowlist stays
    // signed forever, so the current rules are checked here as well: once restricted, only
    // scoped (and so expiring) paths are served.
    if (!scope && isRestricted(await deps.index.visibility(did))) {
      return fail(c, 403, 'access_denied', 'Avatar is restricted; fetch it through /avatar or /u')
    }
    const identity = await deps.resolver.resolveIdentity({ kind: 'did', value: did })
    if (!identity) return fail(c, 404, 'not_found', 'Unknown identity')
    let bytes: Uint8Array
    try {
      const original = await deps.resolver.getBlob(identity, cid)
      // The record's crop picks the square before the resize (spec section 5); none means the center crop.
      const crop = (await deps.index.imageCrop(did, cid)) ?? undefined
      bytes = await deps.resize({ input: original, size, format, quality: quality ?? CANONICAL_QUALITY, ...(crop ? { crop } : {}) })
    } catch (err) {
      if (err instanceof ResizeBusyError) return overloaded(c, err)
      logger.warn('image fetch or resize failed', { requestId: c.get('requestId' as never), did, kind: err instanceof BlobError ? err.kind : 'resize', err })
      if (err instanceof BlobError && err.kind === 'not_found') return fail(c, 404, 'not_found', 'Original image not found')
      return fail(c, 502, 'upstream_error', 'Could not fetch or process the image')
    }
    // /img has no key: a resize on a CDN miss is a service cost against the DID, not a license charge.
    // Cache warming (valid x-warm-auth) is a service cost the indexer chose to incur, so it is not metered.
    metrics.inc('delivery_transforms_total', { format })
    const warm = c.req.header(WARM_HEADER)
    const isWarm = !!deps.warmSecret && !!warm && secretsEqual(warm, deps.warmSecret)
    if (!isWarm) {
      await deps.usage.addService(did, 'transform')
      await deps.usage.addService(did, 'bytes_delivered', bytes.byteLength)
    }
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'content-type': `image/${format}`,
      'cache-control': IMMUTABLE_CACHE_CONTROL,
    })
  })

  // Unsigned legacy shape, or a path with the signature stripped.
  app.get('/img/*', (c) => fail(c, 403, 'invalid_signature', 'Image path is not signed for this service'))
}
