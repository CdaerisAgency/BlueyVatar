import sharp, { type Sharp } from 'sharp'
import { BusyError, centerPixelCrop, limitConcurrency, pixelCrop, resizeLimitsFromEnv, type CropParams } from '@blueyvatar/core'
import { MAX_BLOB_BYTES, MAX_BLOB_MESSAGE, type Check } from '../records'
import { MAX_INPUT_PIXELS, BUSY_MESSAGE } from '../server-resize'
import { colorHex, type FilterId, type Look } from './catalog'

/**
 * Renders a look into a new avatar image (issues #218 and #283). The input is the stored original, never a
 * previous render, so changing a look never stacks on an old one. Output is a square PNG with a transparent
 * corner outside a round frame. The caller sends the result through the same upload steps as any picture
 * (prepareUpload, screenUpload) before it is written to the user's repository.
 *
 * Order: rotate by EXIF, crop to the square the record asks for (center when it has none), resize, apply the filter, then clip to a
 * circle and draw the frame, then the badge. Everything drawn here is built in this file from fixed numbers and the
 * fixed palette, so no user text or free color reaches the SVG.
 */
sharp.cache(false)
sharp.concurrency(1)

/** Rendered images are at most this many pixels on a side. Uploads go up to 4096; an avatar rarely needs more than this. */
export const RENDER_EDGE = 1024
const SHRINK_STEPS = [1, 0.8, 0.6, 0.45] as const

const f = (n: number) => Math.round(n * 100) / 100

function circleMask(e: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${e}" height="${e}"><circle cx="${e / 2}" cy="${e / 2}" r="${e / 2}" fill="#fff"/></svg>`)
}

function frameSvg(e: number, style: NonNullable<Look['frame']>['style'], hex: string): string {
  const c = e / 2
  const w = Math.round(e * 0.07)
  if (style === 'ring') return `<circle cx="${c}" cy="${c}" r="${f(c - w / 2)}" fill="none" stroke="${hex}" stroke-width="${w}"/>`
  if (style === 'double') {
    const outer = Math.round(w * 0.62), thin = Math.max(2, Math.round(w * 0.22)), gap = Math.round(w * 0.3)
    return (
      `<circle cx="${c}" cy="${c}" r="${f(c - outer / 2)}" fill="none" stroke="${hex}" stroke-width="${outer}"/>` +
      `<circle cx="${c}" cy="${c}" r="${f(c - outer - gap - thin / 2)}" fill="none" stroke="${hex}" stroke-width="${thin}"/>`
    )
  }
  if (style === 'thick') {
    const t = Math.round(w * 1.7)
    return `<circle cx="${c}" cy="${c}" r="${f(c - t / 2)}" fill="none" stroke="${hex}" stroke-width="${t}"/>`
  }
  if (style === 'dotted') {
    const r = c - w / 2
    const step = (2 * Math.PI * r) / 36
    return `<circle cx="${c}" cy="${c}" r="${f(r)}" fill="none" stroke="${hex}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="0 ${f(step)}"/>`
  }
  if (style === 'inset') {
    const thin = Math.max(2, Math.round(w * 0.45)), gap = Math.round(w * 0.9)
    return `<circle cx="${c}" cy="${c}" r="${f(c - gap - thin / 2)}" fill="none" stroke="${hex}" stroke-width="${thin}"/>`
  }
  const r = c - w / 2
  const dash = (2 * Math.PI * r) / 48
  return `<circle cx="${c}" cy="${c}" r="${f(r)}" fill="none" stroke="${hex}" stroke-width="${w}" stroke-dasharray="${f(dash)} ${f(dash)}"/>`
}

/** A small sky-blue disc with a white beach umbrella, bottom right. No text, no check mark. */
function awayBadge(e: number): string {
  const cx = e * 0.77, cy = e * 0.77, r = e * 0.19
  const inner = r * 0.84
  const canopy = inner * 0.62
  const top = cy - inner * 0.12
  return (
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="#fff"/>` +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(inner)}" fill="#0ea5e9"/>` +
    `<path d="M ${f(cx - canopy)} ${f(top)} A ${f(canopy)} ${f(canopy)} 0 0 1 ${f(cx + canopy)} ${f(top)} Z" fill="#fff"/>` +
    `<path d="M ${f(cx)} ${f(top)} L ${f(cx)} ${f(cy + inner * 0.5)}" stroke="#fff" stroke-width="${f(inner * 0.1)}" stroke-linecap="round" fill="none"/>`
  )
}

/** Color matrices for the filters, applied to the picture before the mask, frame and badge so those keep their own colors. */
const RECOMB: Partial<Record<FilterId, [[number, number, number], [number, number, number], [number, number, number]]>> = {
  sepia: [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]],
  warm: [[1.1, 0, 0], [0, 1.02, 0], [0, 0, 0.85]],
  cool: [[0.88, 0, 0], [0, 1, 0], [0, 0, 1.12]],
}

function applyFilter(img: Sharp, filter: FilterId | undefined): Sharp {
  if (!filter) return img
  if (filter === 'mono') return img.greyscale()
  if (filter === 'contrast') return img.linear(1.35, -(128 * 0.35))
  return img.recomb(RECOMB[filter]!)
}

export function overlaySvg(e: number, look: Look): Buffer {
  const hex = look.frame ? colorHex(look.frame.color) : undefined
  const body = (look.frame && hex ? frameSvg(e, look.frame.style, hex) : '') + (look.badge === 'away' ? awayBadge(e) : '')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${e}" height="${e}">${body}</svg>`)
}

export type RenderInput = { bytes: Uint8Array; crop?: CropParams | undefined; look: Look }

async function renderAt(input: RenderInput, edge: number): Promise<Buffer> {
  const src = sharp(Buffer.from(input.bytes), { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning' })
  const meta = await src.metadata()
  const swap = (meta.orientation ?? 1) >= 5
  const w = (swap ? meta.height : meta.width) ?? 0
  const h = (swap ? meta.width : meta.height) ?? 0
  const r = input.crop ? pixelCrop(input.crop, w, h) : centerPixelCrop(w, h)
  const e = Math.max(80, Math.min(edge, r.size))
  let img: Sharp = src.rotate().extract({ left: r.left, top: r.top, width: r.size, height: r.size }).resize(e, e, { fit: 'cover' }).toColourspace('srgb')
  if (input.look.filter) {
    // Filters run on the flattened picture in their own step: sharp applies queued operations in its own order, so removing and re-adding alpha has to be two pipelines.
    const flat = await img.removeAlpha().png().toBuffer()
    img = applyFilter(sharp(flat), input.look.filter).toColourspace('srgb')
  }
  img = img.ensureAlpha()
  if (input.look.frame) img = sharp(await img.composite([{ input: circleMask(e), blend: 'dest-in' }]).png().toBuffer())
  return img.composite([{ input: overlaySvg(e, input.look) }]).png({ compressionLevel: 9 }).toBuffer()
}

async function render(input: RenderInput): Promise<Buffer> {
  let last: Buffer | null = null
  for (const s of SHRINK_STEPS) {
    last = await renderAt(input, Math.round(RENDER_EDGE * s))
    if (last.byteLength <= MAX_BLOB_BYTES) return last
  }
  return last!
}

const limitedRender = limitConcurrency(render, resizeLimitsFromEnv(process.env, { maxConcurrent: 1, maxQueue: 4, queueWaitMs: 5000 }))

export async function renderLook(input: RenderInput): Promise<Check<{ bytes: Uint8Array; mime: 'image/png' }>> {
  try {
    const out = await limitedRender(input)
    if (out.byteLength > MAX_BLOB_BYTES) return { ok: false, error: MAX_BLOB_MESSAGE }
    return { ok: true, value: { bytes: new Uint8Array(out), mime: 'image/png' } }
  } catch (err) {
    if (err instanceof BusyError) return { ok: false, error: BUSY_MESSAGE }
    return { ok: false, error: 'The image could not be rendered. Try a different picture.' }
  }
}
