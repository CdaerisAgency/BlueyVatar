import { readFile } from 'node:fs/promises'
import {
  QR_CENTER_OPTIONS, QrOptionError, qrLayout, qrSvgForLayout, type CenterImage, type QrCenter, type QrLayout, CANONICAL_QUALITY, ParamError, parseAvatarParams, parseIdentifier, pickCandidate, qrSvg, type AvatarParams,
} from '@blueyvatar/core'
import type { Hono } from 'hono'
import { gateProfile, type Ctx } from '../context.js'
import type { ErrorCode } from '../errors.js'
import { fail, overloaded } from '../http.js'
import { defaultSvg } from '../defaults.js'
import { ResizeBusyError } from '../resize.js'
import type { Identity } from '../resolver.js'
import { labelBlocksBlob } from '../label-block.js'

const QR_DEFAULT_SIZE = 256

const PLATFORM_SLUG = /^[a-z0-9-]+$/

/** The site's circle logo, read once. apps/web/public/logo.jpg sits three levels up from both src/routes/ and dist/routes/. */
let logoFile: Promise<Uint8Array | null> | undefined
function readLogoFile(): Promise<Uint8Array | null> {
  logoFile ??= readFile(new URL('../../../web/public/logo.jpg', import.meta.url)).then((b) => new Uint8Array(b), () => null)
  return logoFile
}

function dataUri(bytes: Uint8Array, mime: 'image/png' | 'image/jpeg'): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}
const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

export function mountQr(app: Hono, ctx: Ctx): void {
  const { deps, logger, profileBase, entitle, findIdentity } = ctx

  async function logoImage(): Promise<CenterImage | null> {
    const bytes = deps.qrLogo ?? (await readLogoFile())
    if (!bytes) return null
    return { dataUri: dataUri(bytes, isPng(bytes) ? 'image/png' : 'image/jpeg'), shape: 'round' }
  }

  /**
   * The person's current avatar for the QR center. Same rules as the avatar routes: the default
   * rating (g), the same block checks as /img, the record's crop, and the default avatar when
   * there is no usable image. Bytes come from the person's own PDS through the resolver; no other
   * URL is fetched.
   */
  async function avatarImage(identity: Identity, seed: string, px: number): Promise<CenterImage> {
    const picked = pickCandidate(await deps.resolver.candidates(identity), 'g', false)
    if (picked.kind === 'image') {
      const cid = picked.candidate.blob.cid
      if (!(await deps.index.isBlocked(identity.did, cid)) && !(await labelBlocksBlob(deps.index, identity.did, cid))) {
        try {
          const original = await deps.resolver.getBlob(identity, cid)
          const crop = (await deps.index.imageCrop(identity.did, cid)) ?? undefined
          const png = await deps.resize({ input: original, size: px, format: 'png', quality: CANONICAL_QUALITY, ...(crop ? { crop } : {}) })
          return { dataUri: dataUri(png, 'image/png'), shape: 'circle' }
        } catch (err) {
          if (err instanceof ResizeBusyError) throw err
          logger.warn('qr avatar fetch or resize failed', { did: identity.did, err })
        }
      }
    }
    const png = await deps.resize({ input: new TextEncoder().encode(defaultSvg('mp', seed, '')), size: px, format: 'png', quality: 85 })
    return { dataUri: dataUri(png, 'image/png'), shape: 'circle' }
  }

  // QR code for the profile URL. Available on every plan (issue #242). The response depends on the
  // caller's rate window, so it is private to the browser, like the redirects.
  // Options: s (size), center=none|logo|avatar, quiet (quiet zone in modules), to (a verified platform).
  app.get('/qr/:file', async (c) => {
    const e = await entitle(c)
    if (!e.ok) return fail(c, e.status, e.code, e.message)
    const file = c.req.param('file')
    const dot = file.lastIndexOf('.')
    const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : ''
    if (ext !== 'svg' && ext !== 'png') return fail(c, 404, 'not_found', 'Use a .svg or .png path')
    const id = parseIdentifier(file.slice(0, dot))
    if (!id) return fail(c, 400, 'invalid_identifier', 'Expected a hash, handle, or DID')

    let p: AvatarParams
    try {
      const sp = new URL(c.req.url).searchParams
      p = parseAvatarParams(sp, { tier: e.tier, defaultUrlAllowlist: deps.defaultUrlAllowlist })
      if (sp.get('s') === null && sp.get('size') === null) p.size = QR_DEFAULT_SIZE
    } catch (err) {
      if (err instanceof ParamError) return fail(c, 400, err.code as ErrorCode, err.message)
      throw err
    }
    if (p.adjusted.includes('s')) c.header('x-adjusted-params', 's')
    const to = c.req.query('to')
    if (to !== undefined && !PLATFORM_SLUG.test(to)) return fail(c, 400, 'invalid_platform', 'to must be a platform name such as github')
    const center = (c.req.query('center') ?? 'none').toLowerCase() as QrCenter
    if (!(QR_CENTER_OPTIONS as readonly string[]).includes(center)) return fail(c, 400, 'invalid_qr_option', 'center must be none, logo, or avatar')
    const quietRaw = c.req.query('quiet')
    if (quietRaw !== undefined && !/^\d{1,2}$/.test(quietRaw)) return fail(c, 400, 'invalid_qr_option', 'quiet must be a whole number of modules')

    const identity0 = await findIdentity(id)
    if (e.licenseId) await deps.usage.add(e.licenseId, 'origin_resolution')
    // The profile page lives at /p/{handle}, so an identity without a handle has no QR target.
    const gate = await gateProfile(c, ctx, id, e, identity0, { requireHandle: true })
    if (!gate.ok) return gate.res
    const identity = gate.identity

    const base = profileBase
    const target = to ? `${base}/go/${encodeURIComponent(identity.handle)}/${to}` : `${base}/p/${identity.handle}`
    let body: Uint8Array | string
    try {
      if (ext === 'svg' && center === 'none' && quietRaw === undefined) {
        // The plain SVG keeps its original shape (level M, size as asked).
        body = qrSvg(target, p.size)
      } else {
        let image: CenterImage | null = null
        let layout: QrLayout = qrLayout(target, { size: p.size, quiet: quietRaw === undefined ? undefined : Number(quietRaw), center: center !== 'none' })
        if (center !== 'none') {
          const innerPx = Math.max(1, (layout.plate!.size - 2) * layout.modulePx)
          image = center === 'logo' ? await logoImage() : await avatarImage(identity, id.value, innerPx)
          // No usable logo: draw a plain code at level M instead of a blank plate.
          if (!image) layout = qrLayout(target, { size: p.size, quiet: quietRaw === undefined ? undefined : Number(quietRaw), center: false })
        }
        const svg = qrSvgForLayout(target, layout, image ?? undefined)
        c.header('x-qr-version', String(layout.version))
        c.header('x-qr-modules', String(layout.modules))
        c.header('x-qr-pixels', String(layout.pixels))
        body = ext === 'svg' ? svg : await deps.resize({ input: new TextEncoder().encode(svg), size: layout.pixels, format: 'png', quality: 85 })
      }
    } catch (err) {
      if (err instanceof QrOptionError) return fail(c, 400, 'invalid_qr_option', err.message)
      if (err instanceof ResizeBusyError) return overloaded(c, err)
      return fail(c, 502, 'upstream_error', 'Could not render the QR code')
    }
    c.header('cache-control', `private, max-age=${p.ttlSeconds}`)
    c.header('content-type', ext === 'png' ? 'image/png' : 'image/svg+xml')
    return c.body(body as string & Uint8Array<ArrayBuffer>, 200)
  })
}
