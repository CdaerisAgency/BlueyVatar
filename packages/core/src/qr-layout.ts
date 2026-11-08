/**
 * QR codes with an optional center image (issue #242).
 *
 * Module count, pixel size, and the center plate are all calculated from the QR version that
 * `uqr` picks for the text. Nothing about the symbol size is hard-coded.
 *
 * Error correction. A QR symbol at level H restores about 30 percent of its codewords
 * (DENSO WAVE, "Error correction feature", https://www.qrcode.com/en/about/error_correction.html;
 * ISO/IEC 18004). A center image hides modules, and decoders treat them as damage. The plate is
 * limited to half of that budget, `CENTER_AREA_FRACTION`, as a margin for blur, scaling, and
 * phone cameras. The 30 percent is a limit on codewords, so the area rule is a conservative
 * proxy and the tests decode real images to check it. The quiet zone is at least 4 modules
 * (ISO/IEC 18004; qrcode.com says a margin is required).
 */
import { encode } from 'uqr'

export const QR_CENTER_OPTIONS = ['none', 'logo', 'avatar'] as const
export type QrCenter = (typeof QR_CENTER_OPTIONS)[number]

/** Smallest quiet zone in modules. */
export const QR_MIN_QUIET = 4
/** Largest quiet zone this service renders, in modules. */
export const QR_MAX_QUIET = 16
/** Fewest pixels per module. Below this, phone cameras start to miss modules. */
export const QR_MIN_MODULE_PX = 4
/** Largest output edge in pixels. */
export const QR_MAX_PIXELS = 2048
/** What level H can restore, as a share of codewords. */
export const QR_H_RECOVERY = 0.3
/** Share of the symbol area the center plate may cover: half of what H can restore. */
export const CENTER_AREA_FRACTION = QR_H_RECOVERY / 2

export interface QrLayout {
  version: number
  ecc: 'M' | 'H'
  /** Modules per side, without the quiet zone. */
  modules: number
  quiet: number
  /** Modules per side including the quiet zone. */
  totalModules: number
  modulePx: number
  /** Output edge in pixels: a whole number of pixels per module. */
  pixels: number
  /** Center plate in module units, or null when there is no center image. */
  plate: { size: number; x: number; y: number } | null
  /** Plate area divided by symbol area. */
  plateShare: number
}

export interface QrOptions {
  /** Wanted edge in pixels. The result is the largest whole-module size that fits, within the limits. */
  size: number
  quiet?: number
  /** True when a center image will be drawn. Forces error correction level H. */
  center?: boolean
}

export class QrOptionError extends Error {}

/** Largest odd plate edge (in modules) whose area stays within the fraction. Odd keeps it on the center module. */
export function plateModules(modules: number): number {
  let k = Math.floor(Math.sqrt(CENTER_AREA_FRACTION) * modules)
  if (k % 2 === 0) k -= 1
  return Math.max(k, 1)
}

export function qrLayout(text: string, opts: QrOptions): QrLayout {
  const quiet = opts.quiet ?? QR_MIN_QUIET
  if (!Number.isInteger(quiet) || quiet < QR_MIN_QUIET || quiet > QR_MAX_QUIET) {
    throw new QrOptionError(`quiet must be a whole number from ${QR_MIN_QUIET} to ${QR_MAX_QUIET}`)
  }
  const ecc = opts.center ? 'H' : 'M'
  let enc: ReturnType<typeof encode>
  try {
    enc = encode(text, { ecc, border: 0 })
  } catch {
    throw new QrOptionError('text is too long for a QR code')
  }
  const { size: modules, version } = enc
  const totalModules = modules + quiet * 2
  if (totalModules * QR_MIN_MODULE_PX > QR_MAX_PIXELS) throw new QrOptionError('text is too long for a scannable QR code')
  const wanted = Math.min(Math.max(Math.floor(opts.size), 1), QR_MAX_PIXELS)
  const modulePx = Math.max(QR_MIN_MODULE_PX, Math.floor(wanted / totalModules))
  let plate: QrLayout['plate'] = null
  if (opts.center) {
    const k = plateModules(modules)
    const at = quiet + (modules - k) / 2
    plate = { size: k, x: at, y: at }
  }
  return {
    version,
    ecc,
    modules,
    quiet,
    totalModules,
    modulePx,
    pixels: modulePx * totalModules,
    plate,
    plateShare: plate ? (plate.size * plate.size) / (modules * modules) : 0,
  }
}

const DATA_URI = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/

export interface CenterImage {
  /** `data:image/png;base64,...` or `data:image/jpeg;base64,...`. Nothing else is accepted. */
  dataUri: string
  /** `circle` for avatars, `round` for the logo. */
  shape: 'circle' | 'round'
}

/**
 * The SVG for a layout. The viewBox is in modules, so a raster at `layout.pixels` has a whole
 * number of pixels per module. The center image keeps its own aspect ratio (`meet`) inside the
 * plate, with one module of white around it.
 */
export function qrSvgForLayout(text: string, layout: QrLayout, center?: CenterImage): string {
  if (center && !DATA_URI.test(center.dataUri)) throw new QrOptionError('center image must be a PNG or JPEG data URI')
  if (center && !layout.plate) throw new QrOptionError('layout has no plate')
  const { data, size: n } = encode(text, { ecc: layout.ecc, border: 0 })
  if (n !== layout.modules) throw new QrOptionError('layout does not match the text')
  const q = layout.quiet
  const pl = layout.plate
  let d = ''
  for (let y = 0; y < n; y++) {
    const row = data[y]!
    let x = 0
    while (x < n) {
      if (!row[x]) {
        x++
        continue
      }
      const start = x
      while (x < n && row[x]) x++
      d += `M${start + q} ${y + q}h${x - start}v1h-${x - start}z`
    }
  }
  const t = layout.totalModules
  let body = `<rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/>`
  if (center && pl) {
    const inner = pl.size - 2
    const ix = pl.x + 1
    const iy = pl.y + 1
    const clip = center.shape === 'circle'
      ? `<circle cx="${ix + inner / 2}" cy="${iy + inner / 2}" r="${inner / 2}"/>`
      : `<rect x="${ix}" y="${iy}" width="${inner}" height="${inner}" rx="${inner * 0.18}"/>`
    body +=
      `<rect x="${pl.x}" y="${pl.y}" width="${pl.size}" height="${pl.size}" fill="#fff"/>` +
      `<clipPath id="c">${clip}</clipPath>` +
      `<image x="${ix}" y="${iy}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid meet" clip-path="url(#c)" href="${center.dataUri}"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.pixels}" height="${layout.pixels}" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges">${body}</svg>`
}
