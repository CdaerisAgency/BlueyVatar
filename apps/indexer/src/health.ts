import { createServer, type Server } from 'node:http'
import type { Metrics } from '@blueyvatar/core'

export interface HealthOptions {
  /** Fail readiness when neither an event nor a heartbeat arrived within this many milliseconds. */
  windowMs: number
  now?: () => number
}

export interface ReadyState {
  ready: boolean
  reason?: string
  lastEventAgeMs: number
  lastHeartbeatAgeMs: number
  lastEventId: number | null
  outboxBuffer: number | null
}

/**
 * Tracks whether the Tap consumer is alive. A heartbeat is a successful answer from Tap's health
 * endpoint, which keeps an idle but healthy indexer ready. Handler failures start a clock that a
 * success clears: a database that stays down fails readiness even though Tap keeps answering.
 */
export class IndexerHealth {
  private startedAt: number
  private lastEventAt: number | null = null
  private lastHeartbeatAt: number | null = null
  private lastEventId: number | null = null
  private failingSince: number | null = null
  private outbox: number | null = null
  private now: () => number

  constructor(private opts: HealthOptions) {
    this.now = opts.now ?? Date.now
    this.startedAt = this.now()
  }

  markEvent(id?: number): void {
    this.lastEventAt = this.now()
    if (id !== undefined) this.lastEventId = id
    this.failingSince = null
  }

  markFailure(): void {
    this.failingSince ??= this.now()
  }

  markHeartbeat(): void {
    this.lastHeartbeatAt = this.now()
  }

  setOutboxBuffer(n: number | null): void {
    this.outbox = n
  }

  state(): ReadyState {
    const t = this.now()
    const sinceEvent = t - (this.lastEventAt ?? this.startedAt)
    const sinceBeat = t - (this.lastHeartbeatAt ?? this.startedAt)
    let reason: string | undefined
    if (Math.min(sinceEvent, sinceBeat) > this.opts.windowMs) reason = 'no Tap event or heartbeat within the window'
    else if (this.failingSince !== null && t - this.failingSince > this.opts.windowMs) reason = 'event handling has been failing for longer than the window'
    return { ready: !reason, reason, lastEventAgeMs: sinceEvent, lastHeartbeatAgeMs: sinceBeat, lastEventId: this.lastEventId, outboxBuffer: this.outbox }
  }

  /** Copies the current state into gauges. Called before each scrape and readiness answer. */
  publish(m: Metrics): ReadyState {
    const s = this.state()
    m.set('indexer_last_event_age_seconds', Math.round(s.lastEventAgeMs / 1000))
    m.set('indexer_last_heartbeat_age_seconds', Math.round(s.lastHeartbeatAgeMs / 1000))
    if (s.lastEventId !== null) m.set('indexer_last_event_id', s.lastEventId)
    if (s.outboxBuffer !== null) m.set('indexer_tap_outbox_buffer', s.outboxBuffer)
    m.set('indexer_ready', s.ready ? 1 : 0)
    return s
  }
}

/** Pulls the first finite number out of whatever shape the stats endpoint answers with. */
export function firstNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object') for (const x of Object.values(v)) { const n = firstNumber(x); if (n !== null) return n }
  return null
}

export interface TapProbeOptions {
  tapUrl: string
  adminPassword?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

/**
 * One probe of Tap: GET /health for the heartbeat and GET /stats/outbox-buffer for the lag.
 * Both paths are in the Tap README. The stats response shape is not documented there, so the
 * first number found is used. A failure to read the stats never fails the heartbeat.
 */
export async function probeTap(o: TapProbeOptions, health: IndexerHealth): Promise<boolean> {
  const f = o.fetch ?? fetch
  const headers: Record<string, string> = o.adminPassword ? { authorization: 'Basic ' + Buffer.from(`admin:${o.adminPassword}`).toString('base64') } : {}
  const get = (path: string) => f(new URL(path, o.tapUrl), { headers, signal: AbortSignal.timeout(o.timeoutMs ?? 5000) })
  try {
    const res = await get('/health')
    await res.arrayBuffer()
    if (!res.ok) return false
    health.markHeartbeat()
  } catch {
    return false
  }
  try {
    const res = await get('/stats/outbox-buffer')
    if (res.ok) health.setOutboxBuffer(firstNumber(await res.json().catch(() => null)))
    else await res.arrayBuffer()
  } catch {
    /* lag is best effort */
  }
  return true
}

export interface HealthServerOptions {
  health: IndexerHealth
  metrics: Metrics
  port: number
  host?: string
}

/**
 * Small internal HTTP server for Fly checks and scraping. fly/indexer.toml has no [http_service],
 * so nothing here is reachable from the public internet; only Fly's checker and 6PN peers connect.
 * GET /healthz is liveness, GET /readyz is readiness (503 when stalled), GET /metrics is Prometheus text.
 */
export function startHealthServer(o: HealthServerOptions): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (req.method !== 'GET') { res.writeHead(405).end(); return }
    if (path === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'); return }
    if (path === '/readyz') {
      const s = o.health.publish(o.metrics)
      res.writeHead(s.ready ? 200 : 503, { 'content-type': 'application/json' })
        .end(JSON.stringify({ status: s.ready ? 'ready' : 'stalled', reason: s.reason, lastEventAgeSeconds: Math.round(s.lastEventAgeMs / 1000), lastHeartbeatAgeSeconds: Math.round(s.lastHeartbeatAgeMs / 1000), lastEventId: s.lastEventId, outboxBuffer: s.outboxBuffer }))
      return
    }
    if (path === '/metrics') {
      o.health.publish(o.metrics)
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' }).end(o.metrics.render())
      return
    }
    res.writeHead(404).end()
  })
  server.listen(o.port, o.host ?? '::')
  return server
}
