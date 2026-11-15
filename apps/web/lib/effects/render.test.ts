import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { FRAME_COLORS, FRAME_STYLES } from './catalog'
import { overlaySvg, renderLook } from './render'

const photo = async (w = 600, h = 400) =>
  new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer())

async function px(bytes: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(Buffer.from(bytes)).raw().ensureAlpha().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * 4
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! }
}

describe('renderLook', () => {
  it('renders a square PNG from a non-square original', async () => {
    const r = await renderLook({ bytes: await photo(), look: { frame: { style: 'ring', color: 'blue' } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const meta = await sharp(Buffer.from(r.value.bytes)).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(meta.height)
    expect(meta.width).toBe(400)
  })
  it('clips to a circle and draws the ring in the palette color', async () => {
    const r = await renderLook({ bytes: await photo(), look: { frame: { style: 'ring', color: 'blue' } } })
    if (!r.ok) throw new Error(r.error)
    expect((await px(r.value.bytes, 1, 1)).a).toBe(0) // corner is outside the circle
    expect(await px(r.value.bytes, 200, 200)).toMatchObject({ r: 200, g: 40, b: 40, a: 255 }) // photo in the middle
    const edge = await px(r.value.bytes, 200, 6) // inside the ring band at the top
    expect(edge.b).toBeGreaterThan(edge.r)
  })
  it('renders every style and color without error', async () => {
    const bytes = await photo(300, 300)
    for (const s of FRAME_STYLES) for (const c of FRAME_COLORS) expect((await renderLook({ bytes, look: { frame: { style: s.id, color: c.id } } })).ok).toBe(true)
  })
  it('draws only the badge when there is no frame, keeping the square', async () => {
    const r = await renderLook({ bytes: await photo(300, 300), look: { badge: 'away' } })
    if (!r.ok) throw new Error(r.error)
    expect((await px(r.value.bytes, 1, 1)).a).toBe(255)
    const badge = await px(r.value.bytes, Math.round(300 * 0.77) + 14, Math.round(300 * 0.77) + 14)
    expect(badge.b).toBeGreaterThan(200)
  })
  it('uses the record crop', async () => {
    // Left half red, right half blue; crop the right square.
    const left = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ff0000' } }).png().toBuffer()
    const right = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#0000ff' } }).png().toBuffer()
    const img = new Uint8Array(await sharp({ create: { width: 400, height: 200, channels: 3, background: '#000' } }).composite([{ input: left, left: 0, top: 0 }, { input: right, left: 200, top: 0 }]).png().toBuffer())
    const r = await renderLook({ bytes: img, crop: { x: 5000, y: 0, size: 5000 }, look: { badge: 'away' } })
    if (!r.ok) throw new Error(r.error)
    expect(await px(r.value.bytes, 20, 20)).toMatchObject({ r: 0, b: 255 })
  })
  it('rejects bytes that are not an image', async () => {
    expect(await renderLook({ bytes: new Uint8Array([1, 2, 3]), look: { badge: 'away' } })).toMatchObject({ ok: false })
  })
  it('puts only fixed numbers and palette colors in the SVG', () => {
    const svg = overlaySvg(512, { frame: { style: 'double', color: 'pink' }, badge: 'away' }).toString()
    expect(svg).toContain('#db2777')
    expect(svg).not.toMatch(/<text|script|href/)
  })
})
