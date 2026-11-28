import type { Hono } from 'hono'
import { entitlementsFor } from '@blueyvatar/core'
import type { Ctx } from '../context.js'
import { fail, overloaded } from '../http.js'
import { ResizeBusyError } from '../resize.js'
import { DEFAULT_IMG_FILE, respondDefaultImage } from './default.js'

export function mountOverLimit(app: Hono, ctx: Ctx): void {
  const { deps } = ctx

  // Target of the over-limit redirect. Unsigned and public like /default: the owner's uploaded
  // avatar (or the silhouette when none is set) carries no user data.
  app.get('/default/over-limit/:file', async (c) => {
    const m = DEFAULT_IMG_FILE.exec(c.req.param('file'))
    if (!m) return fail(c, 400, 'invalid_format', 'Expected {size}.{png|jpeg|webp}')
    const size = Math.min(Math.max(Number(m[1]), 1), entitlementsFor('free', deps.settings.current()).maxSize)
    const format = m[3] as 'png' | 'jpeg' | 'webp'
    const asset = await deps.overLimitAsset.get()
    if (!asset) return respondDefaultImage(c, deps, 'mp', 'over-limit', '', size, format)
    let bytes: Uint8Array
    try {
      bytes = await deps.resize({ input: asset.bytes, size, format, quality: 85 })
    } catch (err) {
      if (err instanceof ResizeBusyError) return overloaded(c, err)
      throw err
    }
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'content-type': `image/${format}`,
      'cache-control': 'public, max-age=86400',
    })
  })
}
