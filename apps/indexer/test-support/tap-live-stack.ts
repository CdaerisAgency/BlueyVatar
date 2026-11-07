import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Self-contained stack for the live Tap test (issue #42): a local PLC directory and PDS
 * (apps/indexer/live-stack, built on @atproto/dev-env) plus the production-pinned Tap image.
 * Nothing leaves the machine: Tap is pointed at the local PLC directory and at the local PDS as
 * its firehose source, and the test account only exists in the PDS's temp directory.
 *
 * Opt-in: LIVE_TAP_TEST=1 and either Docker or TAP_LIVE_TAP_BIN (a Tap binary built from the same
 * indigo tag). Anything else skips the live test.
 */

const root = new URL('../../../', import.meta.url)
const liveStackDir = fileURLToPath(new URL('apps/indexer/live-stack/', root))

export type ManagedMode = { kind: 'skip'; reason: string } | { kind: 'managed'; runtime: 'docker' | 'binary' }

/** Decides whether the managed stack can run. Cheap: only runs `docker info` when the flag is set. */
export function managedMode(env: NodeJS.ProcessEnv = process.env): ManagedMode {
  if (env.LIVE_TAP_TEST !== '1') return { kind: 'skip', reason: 'LIVE_TAP_TEST is not 1' }
  if (env.TAP_LIVE_TAP_BIN) return { kind: 'managed', runtime: 'binary' }
  const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 20_000 })
  if (docker.status === 0) return { kind: 'managed', runtime: 'docker' }
  return { kind: 'skip', reason: 'LIVE_TAP_TEST=1 but Docker is not available (set TAP_LIVE_TAP_BIN to run a local Tap binary instead)' }
}

/** Tap image and env that production uses, read from fly/tap.toml so the test cannot drift from it. */
export function readTapConfig(): { image: string; signalCollection: string; collectionFilters: string } {
  const toml = readFileSync(new URL('fly/tap.toml', root), 'utf8')
  const pick = (re: RegExp, what: string) => {
    const m = re.exec(toml)
    if (!m?.[1]) throw new Error(`fly/tap.toml: could not find ${what}`)
    return m[1]
  }
  return {
    image: pick(/^\s*image\s*=\s*"([^"]+)"/m, 'the pinned image'),
    signalCollection: pick(/^\s*TAP_SIGNAL_COLLECTION\s*=\s*"([^"]+)"/m, 'TAP_SIGNAL_COLLECTION'),
    collectionFilters: pick(/^\s*TAP_COLLECTION_FILTERS\s*=\s*"([^"]+)"/m, 'TAP_COLLECTION_FILTERS'),
  }
}

export interface LiveStack {
  tapUrl: string
  tapAdminPassword: string
  pdsUrl: string
  plcUrl: string
  did: string
  identifier: string
  appPassword: string
  /** What the pinned image or binary is, for the test log. */
  describe: string
  /** Tail of Tap's stdout and stderr, for failure messages. */
  tapLogs(): string
  stop(): Promise<void>
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function startPds(): Promise<{ proc: ChildProcess; info: { plcUrl: string; pdsUrl: string; did: string; handle: string; password: string } }> {
  if (!existsSync(join(liveStackDir, 'node_modules', '@atproto', 'dev-env'))) {
    throw new Error(`The local PDS is not installed. Run: npm ci --prefix apps/indexer/live-stack (or use pnpm tap:live:local, which does it for you).`)
  }
  const proc = spawn(process.execPath, ['start.mjs'], { cwd: liveStackDir, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  proc.stderr.on('data', (d: Buffer) => (err += d.toString()))
  const info = await new Promise<{ plcUrl: string; pdsUrl: string; did: string; handle: string; password: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`local PDS did not start within 120 s. stderr: ${err.slice(-2000)}`)), 120_000)
    proc.stdout.on('data', (d: Buffer) => {
      out += d.toString()
      const line = out.split('\n').find((l) => l.startsWith('{"ready"'))
      if (line) {
        clearTimeout(timer)
        resolve(JSON.parse(line))
      }
    })
    proc.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`local PDS exited with code ${code} before it was ready. stderr: ${err.slice(-2000)}`))
    })
  })
  return { proc, info }
}

async function waitForHealth(url: string, password: string, alive: () => string | undefined): Promise<void> {
  const auth = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`
  const deadline = Date.now() + 180_000 // includes an image pull on a cold machine
  let last = ''
  while (Date.now() < deadline) {
    const dead = alive()
    if (dead) throw new Error(dead)
    try {
      const res = await fetch(`${url}/health`, { headers: { authorization: auth } })
      if (res.ok) return
      last = `HTTP ${res.status}`
    } catch (e) {
      last = String(e)
    }
    await sleep(500)
  }
  throw new Error(`Tap did not become healthy at ${url}/health (${last})`)
}

export async function startManagedStack(runtime: 'docker' | 'binary'): Promise<LiveStack> {
  const cfg = readTapConfig()
  const pds = await startPds()
  const tapPort = await freePort()
  const tapUrl = `http://127.0.0.1:${tapPort}`
  const adminPassword = randomBytes(12).toString('hex')
  const containerName = `blueyvatar-tap-live-${randomBytes(4).toString('hex')}`
  let tapProc: ChildProcess | undefined
  let tapDir: string | undefined
  let logs = ''
  let tapExit: string | undefined

  // Same settings as fly/tap.toml, with the upstreams pointed at the local PLC directory and PDS.
  // TAP_RETRY_TIMEOUT is short so the test can see an unacked event come back quickly.
  const env: Record<string, string> = {
    TAP_BIND: `127.0.0.1:${tapPort}`,
    TAP_SIGNAL_COLLECTION: cfg.signalCollection,
    TAP_COLLECTION_FILTERS: cfg.collectionFilters,
    TAP_ADMIN_PASSWORD: adminPassword,
    TAP_PLC_URL: pds.info.plcUrl,
    TAP_RELAY_URL: pds.info.pdsUrl,
    TAP_NO_REPLAY: 'true',
    TAP_RETRY_TIMEOUT: process.env.TAP_LIVE_RETRY_TIMEOUT ?? '3s',
    TAP_LOG_LEVEL: 'info',
  }

  let describe: string
  if (runtime === 'docker') {
    // Host networking: the DID document the local PLC directory serves points at http://localhost:<pds port>,
    // and Tap must reach the PDS, the PLC directory, and this process on the same loopback addresses.
    // Native on Linux (including GitHub Actions). On Docker Desktop it needs host networking enabled.
    env.TAP_DATABASE_URL = 'sqlite:///data/tap.db'
    const args = ['run', '--rm', '--name', containerName, '--network', 'host']
    for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`)
    args.push(cfg.image)
    tapProc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    describe = `docker ${cfg.image}`
  } else {
    const bin = process.env.TAP_LIVE_TAP_BIN!
    tapDir = mkdtempSync(join(tmpdir(), 'tap-live-'))
    // A binary built without cgo has no SQLite driver; TAP_LIVE_TAP_DATABASE_URL then points it at Postgres instead.
    env.TAP_DATABASE_URL = process.env.TAP_LIVE_TAP_DATABASE_URL ?? 'sqlite://./tap.db'
    tapProc = spawn(bin, ['run'], { cwd: tapDir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    describe = `binary ${bin} (the image pinned in fly/tap.toml is ${cfg.image}; the binary must be built from the same indigo tag)`
  }
  const append = (d: Buffer) => {
    logs = (logs + d.toString()).slice(-20_000)
  }
  tapProc.stdout?.on('data', append)
  tapProc.stderr?.on('data', append)
  tapProc.once('error', (e) => (tapExit = `could not start Tap: ${e.message}`))
  tapProc.once('exit', (code) => (tapExit = `Tap exited with code ${code}. Logs: ${logs.slice(-2000)}`))

  const stop = async () => {
    if (runtime === 'docker') spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore', timeout: 30_000 })
    tapProc?.kill()
    pds.proc.stdin?.end()
    pds.proc.kill()
    if (tapDir) await sleep(500).then(() => rmSync(tapDir!, { recursive: true, force: true, maxRetries: 5 }))
  }

  try {
    await waitForHealth(tapUrl, adminPassword, () => tapExit)
  } catch (e) {
    await stop()
    throw new Error(`${(e as Error).message}\nTap logs: ${logs.slice(-2000)}`)
  }

  return {
    tapUrl,
    tapAdminPassword: adminPassword,
    pdsUrl: pds.info.pdsUrl,
    plcUrl: pds.info.plcUrl,
    did: pds.info.did,
    identifier: pds.info.handle,
    appPassword: pds.info.password,
    describe,
    tapLogs: () => logs,
    stop,
  }
}
