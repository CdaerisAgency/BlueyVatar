import type pg from 'pg'
import { errors, log } from '../obs.js'

/** What one scheduled job needs. `name` is the error-tracker tag and, with underscores as spaces, the log text unless `label` is given. */
export type JobDef<R = unknown> = {
  name: string
  everyMs: number
  run: () => Promise<R>
  /** Log text for this job when it differs from `name` with spaces. */
  label?: string
  /** Turns a result into log fields. Return nothing to stay quiet (most runs find nothing to do). */
  summarize?: (result: R) => Record<string, unknown> | undefined | null | false | 0 | ''
  /** Run once right away, then on the interval. Default true. */
  startNow?: boolean
}

/** Builds a job from the pool, or returns null when its settings turn it off. One of these per job module goes in the `jobs` list in index.ts. */
export type JobFactory = (pool: pg.Pool, env?: Record<string, string | undefined>) => JobDef | null

/** Fixes a job's result type so jobs with different results fit one list: its summary is computed inside `run`. */
export function job<R>(def: JobDef<R>): JobDef {
  const { summarize, run, ...rest } = def
  return { ...rest, run: async () => { const r = await run(); return summarize?.(r) || undefined }, summarize: (fields) => fields as Record<string, unknown> | undefined }
}

/** Runs a job now and then on an interval, never overlapping itself. Failures are logged and retried on the next tick. */
export function scheduleJob<R>(job: JobDef<R>): NodeJS.Timeout {
  const label = job.label ?? job.name.replace(/_/g, ' ')
  let running = false
  const tick = () => {
    if (running) return
    running = true
    job.run()
      .then((r) => {
        const fields = job.summarize?.(r)
        if (fields) log.info(label, fields)
      })
      .catch((err) => {
        log.error(`${label} failed`, { err })
        errors.captureException(err, { tags: { task: job.name } })
      })
      .finally(() => { running = false })
  }
  if (job.startNow !== false) tick()
  const timer = setInterval(tick, job.everyMs)
  timer.unref()
  return timer
}

/** Starts every job in order, skipping the ones that turned themselves off. */
export function startJobs(pool: pg.Pool, jobs: JobFactory[]): void {
  for (const make of jobs) {
    const job = make(pool)
    if (job) scheduleJob(job)
  }
}
