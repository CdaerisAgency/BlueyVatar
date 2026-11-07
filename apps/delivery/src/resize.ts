import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BusyError, DEFAULT_RESIZE_LIMITS, limitConcurrency, resizeLimitsFromEnv, type ConcurrencyLimits, type CropParams } from '@blueyvatar/core'

export { DEFAULT_RESIZE_LIMITS, resizeLimitsFromEnv }

export interface ResizeJob {
  input: Uint8Array
  size: number
  format: 'png' | 'jpeg' | 'webp'
  quality: number
  /** Square region of the original to show (spec section 5). Absent means the center crop. */
  crop?: CropParams
}

export type Resizer = (job: ResizeJob) => Promise<Uint8Array>

export interface SandboxOptions {
  timeoutMs?: number
  maxOldSpaceMb?: number
  /** Threads sharp may use inside one worker. Default 1; total threads are this times the concurrency cap. */
  sharpThreads?: number
}

/** Resize in a forked process with a heap cap and a hard timeout. */
export function sandboxedResizer(opts: SandboxOptions = {}): Resizer {
  const workerPath = fileURLToPath(new URL('./resize-worker.js', import.meta.url))
  const timeoutMs = opts.timeoutMs ?? 10_000
  const heap = opts.maxOldSpaceMb ?? 256
  return (job) =>
    new Promise((resolve, reject) => {
      const child = fork(workerPath, [], {
        execArgv: [`--max-old-space-size=${heap}`],
        env: { PATH: process.env.PATH ?? '', BV_SHARP_THREADS: String(opts.sharpThreads ?? 1) },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        serialization: 'json',
      })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('resize timed out'))
      }, timeoutMs)
      child.once('message', (msg: { ok: boolean; output?: string; error?: string }) => {
        clearTimeout(timer)
        if (msg.ok && msg.output) resolve(new Uint8Array(Buffer.from(msg.output, 'base64')))
        else reject(new Error(msg.error ?? 'resize failed'))
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        if (code !== 0) reject(new Error(`resize worker exited with ${code}`))
      })
      child.send({
        input: Buffer.from(job.input).toString('base64'),
        size: job.size,
        format: job.format,
        quality: job.quality,
        crop: job.crop,
      })
    })
}

/** Thrown when the transform queue is full or a job waited too long. The route answers 503 with Retry-After. */
export class ResizeBusyError extends BusyError {
  constructor(retryAfterSeconds: number) {
    super(retryAfterSeconds, 'resize capacity exhausted')
  }
}

export type ResizeLimits = ConcurrencyLimits

/** Caps concurrent resizes with a short FIFO queue. A full queue or a long wait rejects with ResizeBusyError. */
export function limitedResizer(inner: Resizer, limits: ResizeLimits): Resizer {
  return limitConcurrency(inner, limits, (s) => new ResizeBusyError(s))
}
