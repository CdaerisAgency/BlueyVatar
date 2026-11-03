import { encode } from 'uqr'

/** Modules of white border around the code. The QR spec asks for at least 4. */
const QUIET_ZONE = 4

/**
 * Render a QR code as a square SVG, `size` pixels on a side (spec section 8).
 * Medium error correction. Rows are merged into one path so the output stays small.
 */
export function qrSvg(text: string, size: number): string {
  const { data, size: n } = encode(text, { ecc: 'M', border: 0 })
  const total = n + QUIET_ZONE * 2
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
      d += `M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${x - start}v1h-${x - start}z`
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
  )
}
