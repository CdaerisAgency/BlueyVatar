import type { Hono } from 'hono'
import { DEFAULT_STYLES, type DefaultStyle } from '@blueyvatar/core'
import type { Ctx } from '../context.js'
import { fail, overloaded } from '../http.js'
import { cleanInitials, defaultSvg } from '../defaults.js'
import { ResizeBusyError } from '../resize.js'

const IMG_FILE = /^(\d{1,4})(?:-q(\d{1,3}))?\.(png|jpeg|webp)$/

export function mountDefault(app: Hono, ctx: Ctx): void {
  const { deps } = ctx

  // Defaults stay unsigned: they carry no user content, no visibility rule applies to them, and
  // the output is a pure function of the public style, seed, and initials, so there is nothing
  // for a signature to protect. The 24h public cache bounds the resize cost.
  app.get('/default/:style/:file', async (c) => {
    const style = c.req.param('style')
    const m = IMG_FILE.exec(c.req.param('file'))
    if (!m || !(DEFAULT_STYLES as readonly string[]).includes(style) || style === '404') {
      return fail(c, 404, 'not_found', 'Unknown default')
    }
    const size = Math.min(Number(m[1]), 2048)
    const seed = c.req.query('seed') ?? ''
    const svg = defaultSvg(style as DefaultStyle, seed, cleanInitials(c.req.query('initials')))
    let bytes: Uint8Array
    try {
      bytes = await deps.resize({ input: new TextEncoder().encode(svg), size, format: m[3] as 'png', quality: 85 })
    } catch (err) {
      if (err instanceof ResizeBusyError) return overloaded(c, err)
      throw err
    }
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'content-type': `image/${m[3]}`,
      'cache-control': 'public, max-age=86400',
    })
  })
}
