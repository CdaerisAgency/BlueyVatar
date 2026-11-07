/**
 * Concurrency limiter for image resizes, shared by the delivery service and the web uploader
 * (issue #198 for delivery, issue #203 for the upload fallback). A job runs at once if a slot is
 * free, waits in a short FIFO queue otherwise, and is shed when the queue is full or the wait is too long.
 */

/** Thrown when the queue is full or a job waited too long. */
export class BusyError extends Error {
  constructor(readonly retryAfterSeconds: number, message = 'capacity exhausted') {
    super(message)
  }
}

export interface ConcurrencyLimits {
  /** Jobs allowed to run at once. */
  maxConcurrent: number
  /** Jobs allowed to wait for a slot. Beyond this, jobs are shed at once. */
  maxQueue: number
  /** Longest a job may wait for a slot before it is shed. */
  queueWaitMs: number
  retryAfterSeconds?: number
  /** Called after every change with the current counts, and with `shed` once per rejected job. */
  onChange?: (state: { inFlight: number; queued: number; shed?: boolean }) => void
}

/** Default cap for a 512 MB VM: server and caches take about 150 to 250 MB, leaving room for 2 resizes. */
export const DEFAULT_RESIZE_LIMITS = { maxConcurrent: 2, maxQueue: 8, queueWaitMs: 3000 } as const

/** Reads IMG_MAX_CONCURRENT, IMG_QUEUE_MAX, and IMG_QUEUE_WAIT_MS. Invalid values fall back to the defaults. */
export function resizeLimitsFromEnv(
  env: Record<string, string | undefined> = process.env,
  defaults: Pick<ConcurrencyLimits, 'maxConcurrent' | 'maxQueue' | 'queueWaitMs'> = DEFAULT_RESIZE_LIMITS,
): Omit<ConcurrencyLimits, 'onChange'> {
  const num = (v: string | undefined, d: number, min: number) => {
    const n = Number(v)
    return v !== undefined && v !== '' && Number.isFinite(n) && n >= min ? Math.floor(n) : d
  }
  return {
    maxConcurrent: num(env.IMG_MAX_CONCURRENT, defaults.maxConcurrent, 1),
    maxQueue: num(env.IMG_QUEUE_MAX, defaults.maxQueue, 0),
    queueWaitMs: num(env.IMG_QUEUE_WAIT_MS, defaults.queueWaitMs, 0),
  }
}

/** Wraps an async function so at most `maxConcurrent` calls run at once, with a short FIFO queue. `makeBusy` builds the shed error. */
export function limitConcurrency<A extends unknown[], R>(
  inner: (...args: A) => Promise<R>,
  limits: ConcurrencyLimits,
  makeBusy: (retryAfterSeconds: number) => Error = (s) => new BusyError(s),
): (...args: A) => Promise<R> {
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

  return async (...args) => {
    if (inFlight < limits.maxConcurrent) {
      inFlight += 1
      notify()
    } else {
      if (waiters.length >= limits.maxQueue) {
        notify(true)
        throw makeBusy(retryAfter)
      }
      await new Promise<void>((resolve, reject) => {
        const w = {
          grant: resolve,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(w), 1)
            notify(true)
            reject(makeBusy(retryAfter))
          }, limits.queueWaitMs),
        }
        waiters.push(w)
        notify()
      })
    }
    try {
      return await inner(...args)
    } finally {
      release()
    }
  }
}
