import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_EDGE, screenshotProblem } from '../lib/bug-report'

/**
 * Turns a picture into a screenshot the report can keep: re-drawn on a canvas and saved as JPEG, which drops every
 * piece of metadata (camera, location, and so on), scaled to SCREENSHOT_MAX_EDGE, and held under SCREENSHOT_MAX_BYTES.
 * The server cleans it again before storing it (lib/bug-report-screenshot.ts). Same approach as Cadence's screenshot helper (getDisplayMedia plus a canvas), without a page-rendering library:
 * no new dependency or license, and it captures what is on screen, not a re-render of the page.
 */

/** True when this browser can capture the current tab. Asked after mount, never while rendering on the server. */
export function canCaptureScreen(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

async function reencode(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  let scale = Math.min(1, SCREENSHOT_MAX_EDGE / Math.max(width, height))
  for (const quality of [0.72, 0.55, 0.4]) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser could not resize that picture.')
    // JPEG has no transparency: a transparent PNG would turn black without this.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    const blob = await toBlob(canvas, quality)
    if (blob && blob.size <= SCREENSHOT_MAX_BYTES) return blob
    scale *= 0.8
  }
  throw new Error(`That picture is still over ${SCREENSHOT_MAX_BYTES / 1024 / 1024} MB after shrinking. Choose a smaller one.`)
}

/** A picture the person chose or dropped. Refused before it is read when it is not a PNG, JPEG, or WebP, or is too big. */
export async function fileToScreenshot(file: File): Promise<Blob> {
  const problem = screenshotProblem(file)
  if (problem) throw new Error(problem)
  const bitmap = await createImageBitmap(file)
  try {
    return await reencode(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

/**
 * One frame of this tab. Null when the person closed the browser's picker, which is an answer and not a failure.
 * The video track is always stopped, so the browser stops saying the page is sharing the screen.
 */
export async function captureTab(): Promise<Blob | null> {
  if (!canCaptureScreen()) return null
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      audio: false,
      // Chromium only. Other browsers ignore these keys and show their own picker.
      ...({ preferCurrentTab: true, selfBrowserSurface: 'include', monitorTypeSurfaces: 'exclude', surfaceSwitching: 'exclude' } as DisplayMediaStreamOptions),
    })
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (!video.videoWidth || !video.videoHeight) throw new Error('The capture came back empty. Try again, or attach a picture instead.')
    const blob = await reencode(video, video.videoWidth, video.videoHeight)
    video.srcObject = null
    return blob
  } catch (err) {
    const name = (err as { name?: string }).name
    if (name === 'NotAllowedError' || name === 'AbortError') return null
    throw err
  } finally {
    stream?.getTracks().forEach((t) => t.stop())
  }
}

/** The picture as base64 (no data URL prefix), for the JSON body of the report. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error('The screenshot could not be read.'))
    r.readAsDataURL(blob)
  })
}
