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
        env: { PATH: process.env.PATH ?? '' },
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
