'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { cropFromRect } from '@blueyvatar/core/crop'
import { MAX_BLOB_BYTES, MAX_LONG_SIDE, MIN_SIDE, TOO_SMALL_MESSAGE, decodeImage, prepareImage } from '../../../lib/client-resize'
import { centerCrop, dragDelta, isSquare, maxZoom, moveCrop, zoomCrop, zoomOf, type CropRect } from '../../../lib/crop'

const sameRect = (a: CropRect, b: CropRect) => a.x === b.x && a.y === b.y && a.size === b.size

const PREVIEW = 320
const MAX_MB = MAX_BLOB_BYTES / (1024 * 1024)

/**
 * File input for avatar and gallery uploads. The full original is uploaded (issue #203): an image longer than
 * 4096 pixels or over the byte cap is first shrunk in the browser with the whole frame kept, never cropped. For a
 * non-square image it shows a square crop box (default: the center crop delivery uses) that the user can drag, zoom,
 * and move with the keyboard. The box does not change the file. It fills three hidden fields (cropX, cropY, cropSize,
 * integers in 1/10000 of the image) that the server saves in the image record, and delivery applies them before
 * resizing. A box left at the center crop sends no fields. Best effort; see lib/client-resize.ts. The server checks
 * are unchanged, and it downscales anything still above 4096 pixels.
 */
export default function ImageFileInput() {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bmpRef = useRef<ImageBitmap | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState<CropRect | null>(null)
  const [cropping, setCropping] = useState(false)

  const closeBitmap = () => {
    bmpRef.current?.close()
    bmpRef.current = null
  }
  useEffect(() => closeBitmap, [])

  useEffect(() => {
    const bmp = bmpRef.current
    const ctx = canvasRef.current?.getContext('2d')
    if (!cropping || !rect || !bmp || !ctx) return
    ctx.clearRect(0, 0, PREVIEW, PREVIEW)
    ctx.drawImage(bmp, rect.x, rect.y, rect.size, rect.size, 0, 0, PREVIEW, PREVIEW)
  }, [cropping, rect])

  function setFile(out: File) {
    const input = inputRef.current
    if (!input) return false
    try {
      const dt = new DataTransfer()
      dt.items.add(out)
      input.files = dt.files
      return true
    } catch {
      return false // Browser cannot set files programmatically; the server will check the original.
    }
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    setNote('')
    setError('')
    setCropping(false)
    setRect(null)
    setDims(null)
    closeBitmap()
    if (!file) return

    const bmp = await decodeImage(file)
    if (bmp && Math.min(bmp.width, bmp.height) < MIN_SIDE) {
      bmp.close()
      setError(TOO_SMALL_MESSAGE)
      input.value = ''
      return
    }
    const result = await prepareImage(file, bmp ?? undefined)
    if (result.error !== undefined) {
      bmp?.close()
      setError(result.error)
      input.value = ''
      return
    }
    if (result.file !== file) {
      const resized = result.file.size < file.size * 0.9 || (bmp !== null && Math.max(bmp.width, bmp.height) > MAX_LONG_SIDE)
      if (setFile(result.file) && resized) setNote(`Resized to ${Math.round(result.file.size / 1000)} KB before upload. The whole image is kept.`)
    }
    if (bmp && !isSquare(bmp.width, bmp.height)) {
      bmpRef.current = bmp
      setDims({ w: bmp.width, h: bmp.height })
      setRect(centerCrop(bmp.width, bmp.height))
      setCropping(true)
      return
    }
    bmp?.close()
  }

  const move = (dx: number, dy: number) => dims && setRect((r) => (r ? moveCrop(r, dx, dy, dims.w, dims.h) : r))
  const zoom = (z: number) => dims && setRect((r) => (r ? zoomCrop(r, z, dims.w, dims.h) : r))
  const step = rect ? Math.max(1, Math.round(rect.size * 0.05)) : 1

  function onKeyDown(e: React.KeyboardEvent) {
    if (!rect || !dims) return
    const big = e.shiftKey ? 4 : 1
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(-step * big, 0),
      ArrowRight: () => move(step * big, 0),
      ArrowUp: () => move(0, -step * big),
      ArrowDown: () => move(0, step * big),
      '+': () => zoom(zoomOf(rect, dims.w, dims.h) * 1.1),
      '=': () => zoom(zoomOf(rect, dims.w, dims.h) * 1.1),
      '-': () => zoom(zoomOf(rect, dims.w, dims.h) / 1.1),
    }
    const run = keys[e.key]
    if (run) {
      e.preventDefault()
      run()
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY }
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const last = drag.current
    if (!last || !rect) return
    const side = e.currentTarget.getBoundingClientRect().width || PREVIEW
    const { dx, dy } = dragDelta(e.clientX - last.x, e.clientY - last.y, side, rect)
    drag.current = { x: e.clientX, y: e.clientY }
    move(dx, dy)
  }
  const endDrag = () => {
    drag.current = null
  }

  // Crop parameters for the record. Blank when the box is at the center crop, which delivery applies by default.
  const crop = rect && dims && !sameRect(rect, centerCrop(dims.w, dims.h)) ? cropFromRect(rect, dims.w, dims.h) : null

  const hintId = `${id}-hint`
  return (
    <>
      <label>
        Image{' '}
        <input ref={inputRef} name="file" type="file" accept="image/png,image/jpeg" required onChange={onChange} aria-describedby={hintId} />
      </label>
      <input type="hidden" name="cropX" value={crop?.x ?? ''} />
      <input type="hidden" name="cropY" value={crop?.y ?? ''} />
      <input type="hidden" name="cropSize" value={crop?.size ?? ''} />
      <p id={hintId}>
        PNG or JPEG, at least {MIN_SIDE} by {MIN_SIDE} pixels, up to {MAX_MB} MB. Any size is fine: an image longer than {MAX_LONG_SIDE} pixels or larger than {MAX_MB} MB is
        shrunk to fit, in your browser first, and the whole picture is kept. For a non-square image you can drag and zoom a square box to choose what shows as your
        avatar. The box is saved next to the image, so the file itself is never cropped. If you leave it alone, the center square shows. Photo details such as
        location and camera model are removed from every upload.
      </p>
      {cropping && rect && dims && (
        <div role="group" aria-label="Crop image">
          <p id={`${id}-help`}>
            Drag the picture to choose the square that will show, or focus it and use the arrow keys to move it (hold Shift to move faster) and plus and minus to zoom.
          </p>
          <canvas
            ref={canvasRef}
            width={PREVIEW}
            height={PREVIEW}
            tabIndex={0}
            role="img"
            aria-label="Crop preview: the square region that will show"
            aria-describedby={`${id}-help`}
            data-testid="crop-preview"
            style={{ width: '100%', maxWidth: PREVIEW, aspectRatio: '1 / 1', touchAction: 'none', cursor: 'grab' }}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          <p>
            <label>
              Zoom{' '}
              <input
                type="range"
                min={1}
                max={maxZoom(dims.w, dims.h)}
                step={0.01}
                value={zoomOf(rect, dims.w, dims.h)}
                onChange={(e) => zoom(Number(e.currentTarget.value))}
              />
            </label>
          </p>
          <p>
            <Button type="button" onClick={() => move(-step, 0)}>Move left</Button>{' '}
            <Button type="button" onClick={() => move(step, 0)}>Move right</Button>{' '}
            <Button type="button" onClick={() => move(0, -step)}>Move up</Button>{' '}
            <Button type="button" onClick={() => move(0, step)}>Move down</Button>{' '}
            <Button type="button" onClick={() => setRect(centerCrop(dims.w, dims.h))}>Reset to center crop</Button>
          </p>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {note && <p role="status">{note}</p>}
    </>
  )
}
