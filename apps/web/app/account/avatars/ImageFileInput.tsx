'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { MIN_SIDE, TOO_SMALL_MESSAGE, decodeImage, prepareImage } from '../../../lib/client-resize'
import { centerCrop, dragDelta, isSquare, maxZoom, moveCrop, zoomCrop, zoomOf, type CropRect } from '../../../lib/crop'

const PREVIEW = 320
const PENDING_MESSAGE = 'Apply the crop before uploading.'

/**
 * File input for avatar and gallery uploads. A square image is downscaled in the browser as before. For a non-square
 * image it shows a square crop box (default: the center crop delivery uses) that the user can drag, zoom, and move with
 * the keyboard, renders that region to a canvas, and runs the same resize and recompress steps. Best effort; see
 * lib/client-resize.ts. The server checks are unchanged.
 */
export default function ImageFileInput() {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bmpRef = useRef<ImageBitmap | null>(null)
  const sourceRef = useRef<File | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState<CropRect | null>(null)
  const [cropping, setCropping] = useState(false)
  const [applied, setApplied] = useState(false)

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
    setApplied(false)
    setRect(null)
    setDims(null)
    input.setCustomValidity('')
    closeBitmap()
    sourceRef.current = null
    if (!file) return

    const bmp = await decodeImage(file)
    if (bmp && Math.min(bmp.width, bmp.height) < MIN_SIDE) {
      bmp.close()
      setError(TOO_SMALL_MESSAGE)
      input.value = ''
      return
    }
    if (bmp && !isSquare(bmp.width, bmp.height)) {
      bmpRef.current = bmp
      sourceRef.current = file
      setDims({ w: bmp.width, h: bmp.height })
      setRect(centerCrop(bmp.width, bmp.height))
      setCropping(true)
      input.setCustomValidity(PENDING_MESSAGE)
      return
    }
    bmp?.close()
    const result = await prepareImage(file)
    if (result.error !== undefined) {
      setError(result.error)
      input.value = ''
      return
    }
    if (result.file !== file && setFile(result.file)) setNote(`Resized to ${Math.round(result.file.size / 1000)} KB before upload.`)
  }

  async function apply() {
    const bmp = bmpRef.current
    const source = sourceRef.current
    if (!bmp || !source || !rect) return
    setError('')
    const result = await prepareImage(source, rect, bmp)
    if (result.error !== undefined) {
      setError(result.error)
      return
    }
    if (!setFile(result.file)) {
      setError('This browser could not attach the cropped image. Upload a square image instead.')
      return
    }
    inputRef.current?.setCustomValidity('')
    setCropping(false)
    setApplied(true)
    setNote(`Cropped to a square and resized to ${Math.round(result.file.size / 1000)} KB before upload.`)
  }

  function reopen() {
    setNote('')
    setApplied(false)
    setCropping(true)
    inputRef.current?.setCustomValidity(PENDING_MESSAGE)
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

  const hintId = `${id}-hint`
  return (
    <>
      <label>
        Image{' '}
        <input ref={inputRef} name="file" type="file" accept="image/png,image/jpeg" required onChange={onChange} aria-describedby={hintId} />
      </label>
      <p id={hintId}>
        PNG or JPEG, at least {MIN_SIDE} by {MIN_SIDE} pixels, up to 1,000,000 bytes after upload. Large images are resized in your browser first. For a non-square image you
        can drag and zoom a square crop box before uploading, and the cropped square is what gets stored. A square image is uploaded as is. If your browser cannot read the
        image, the original is uploaded and delivery crops it to the center square.
      </p>
      {cropping && rect && dims && (
        <div role="group" aria-label="Crop image">
          <p id={`${id}-help`}>
            Drag the picture to choose the square that will be your image, or focus it and use the arrow keys to move it (hold Shift to move faster) and plus and minus to zoom.
          </p>
          <canvas
            ref={canvasRef}
            width={PREVIEW}
            height={PREVIEW}
            tabIndex={0}
            role="img"
            aria-label="Crop preview: the square region that will be uploaded"
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
            <Button type="button" onClick={() => setRect(centerCrop(dims.w, dims.h))}>Reset to center crop</Button>{' '}
            <Button type="button" variant="primary" onClick={apply}>Apply crop</Button>
          </p>
        </div>
      )}
      {applied && (
        <p>
          <Button type="button" onClick={reopen}>Adjust crop</Button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {note && <p role="status">{note}</p>}
    </>
  )
}
