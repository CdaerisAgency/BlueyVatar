import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export interface ResizeJob {
  input: Uint8Array
  size: number
  format: 'png' | 'jpeg' | 'webp'
  quality: number
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
      })
    })
}

/** Thrown when the transform queue is full or a job waited too long. The route answers 503 with Retry-After. */
export class ResizeBusyError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('resize capacity exhausted')
  }
}

export interface ResizeLimits {
  /** Resize children allowed at once. Each is about 65 to 70 MB resident (docs/research/load-test-v1.md). */
  maxConcurrent: number
  /** Jobs allowed to wait for a slot. Beyond this, requests are shed at once. */
  maxQueue: number
  /** Longest a job may wait for a slot before it is shed. */
  queueWaitMs: number
  retryAfterSeconds?: number
  /** Called after every change with the current counts, and with `shed` once per rejected job. */
  onChange?: (state: { inFlight: number; queued: number; shed?: boolean }) => void
}

/** Default cap for the 512 MB delivery VM: server and 32 MB blob cache take about 150 to 250 MB, leaving room for 2 children. */
export const DEFAULT_RESIZE_LIMITS = { maxConcurrent: 2, maxQueue: 8, queueWaitMs: 3000 } as const

/** Reads IMG_MAX_CONCURRENT, IMG_QUEUE_MAX, and IMG_QUEUE_WAIT_MS. Invalid values fall back to the defaults. */
export function resizeLimitsFromEnv(env: Record<string, string | undefined> = process.env): Omit<ResizeLimits, 'onChange'> {
  const num = (v: string | undefined, d: number, min: number) => {
    const n = Number(v)
    return v !== undefined && v !== '' && Number.isFinite(n) && n >= min ? Math.floor(n) : d
  }
  return {
    maxConcurrent: num(env.IMG_MAX_CONCURRENT, DEFAULT_RESIZE_LIMITS.maxConcurrent, 1),
    maxQueue: num(env.IMG_QUEUE_MAX, DEFAULT_RESIZE_LIMITS.maxQueue, 0),
    queueWaitMs: num(env.IMG_QUEUE_WAIT_MS, DEFAULT_RESIZE_LIMITS.queueWaitMs, 0),
  }
}

/** Caps concurrent resizes with a short FIFO queue. A full queue or a long wait rejects with ResizeBusyError. */
export function limitedResizer(inner: Resizer, limits: ResizeLimits): Resizer {
  const retryAfter = limits.retryAfterSeconds ?? 2
  let inFlight = 0
  const waiters: Array<{ grant: () => void; timer: ReturnType<typeof setTimeout> }> = []
  const notify = (shed?: boolean) => limits.onChange?.({ inFlight, queued: waiters.length, shed })

  function release() {
    const next = waiters.shift()
    if (next) {
      clearTimeout(next.timer)
      next.grant() // the slot passes straight to the waiter, so inFlight is unchanged
    } else inFlight -= 1
    notify()
  }

  return async (job) => {
    if (inFlight < limits.maxConcurrent) {
      inFlight += 1
      notify()
    } else {
      if (waiters.length >= limits.maxQueue) {
        notify(true)
        throw new ResizeBusyError(retryAfter)
      }
      await new Promise<void>((resolve, reject) => {
        const w = {
          grant: resolve,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(w), 1)
            notify(true)
            reject(new ResizeBusyError(retryAfter))
          }, limits.queueWaitMs),
        }
        waiters.push(w)
        notify()
      })
    }
    try {
      return await inner(job)
    } finally {
      release()
    }
  }
}
