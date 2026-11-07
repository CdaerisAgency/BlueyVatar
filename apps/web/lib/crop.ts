// Square crop math for the upload flow. Pure functions, no DOM, so the rules are unit tested.
//
// A crop is a square region of the source image in source pixels. The default is the same
// deterministic center crop that delivery applies to a non-square source (spec section 5).

export const MIN_CROP_SIDE = 80

export type CropRect = { x: number; y: number; size: number }

export const isSquare = (w: number, h: number) => w === h

/** The center square delivery would take: the short side, centered on the long side. */
export function centerCrop(w: number, h: number): CropRect {
  const size = Math.min(w, h)
  return { x: Math.floor((w - size) / 2), y: Math.floor((h - size) / 2), size }
}

/** The largest zoom that keeps the crop at or above the minimum side (never below 1). */
export function maxZoom(w: number, h: number, minSide = MIN_CROP_SIDE): number {
  return Math.max(1, Math.min(w, h) / minSide)
}

/** Keeps a rect inside the image: size within [1, short side], position within bounds. */
export function clampCrop(rect: CropRect, w: number, h: number): CropRect {
  const size = Math.max(1, Math.min(Math.round(rect.size), Math.min(w, h)))
  return {
    size,
    x: Math.max(0, Math.min(Math.round(rect.x), w - size)),
    y: Math.max(0, Math.min(Math.round(rect.y), h - size)),
  }
}

/** The zoom factor of a rect: 1 shows the whole short side, 2 shows half of it. */
export function zoomOf(rect: CropRect, w: number, h: number): number {
  return Math.min(w, h) / rect.size
}

/** Resizes the crop to the given zoom (clamped to [1, maxZoom]) around its current center. */
export function zoomCrop(rect: CropRect, zoom: number, w: number, h: number): CropRect {
  const z = Math.max(1, Math.min(zoom, maxZoom(w, h)))
  const size = Math.round(Math.min(w, h) / z)
  const cx = rect.x + rect.size / 2
  const cy = rect.y + rect.size / 2
  return clampCrop({ size, x: cx - size / 2, y: cy - size / 2 }, w, h)
}

/** Moves the crop by (dx, dy) source pixels, staying inside the image. */
export function moveCrop(rect: CropRect, dx: number, dy: number, w: number, h: number): CropRect {
  return clampCrop({ ...rect, x: rect.x + dx, y: rect.y + dy }, w, h)
}

/** True when the rect is the whole image, so no crop is needed. */
export const coversImage = (rect: CropRect, w: number, h: number) => rect.x === 0 && rect.y === 0 && rect.size === w && rect.size === h

/** True when the cropped result meets the minimum side. */
export const meetsMinimum = (rect: CropRect, minSide = MIN_CROP_SIDE) => rect.size >= minSide

/** Converts a pointer drag in preview pixels into a source-pixel move. Dragging right pulls the image right, so the region moves left. */
export function dragDelta(dxPreview: number, dyPreview: number, previewSide: number, rect: CropRect): { dx: number; dy: number } {
  const scale = rect.size / previewSide
  return { dx: -dxPreview * scale, dy: -dyPreview * scale }
}
