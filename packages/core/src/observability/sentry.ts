import { randomBytes } from 'node:crypto'
import { scrubHeaders, scrubText, scrubUrl, scrubValue } from './scrub.js'

/**
 * Minimal Sentry-compatible error reporter. It speaks the public envelope protocol
 * (https://develop.sentry.dev/sdk/data-model/envelopes/), so a Sentry project or any
 * compatible server (GlitchTip, self-hosted Sentry) accepts it. It is off unless SENTRY_DSN is set.
 * No SDK dependency: the event is built here, scrubbed, and posted with fetch, fire and forget.
 */
export interface ParsedDsn {
  key: string
  endpoint: string
  dsn: string
}

export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null
  try {
    const u = new URL(dsn)
    const parts = u.pathname.split('/').filter(Boolean)
    const project = parts.pop()
    if (!u.username || !project || !/^\d+$/.test(project)) return null
    const prefix = parts.length ? `/${parts.join('/')}` : ''
    return { key: u.username, endpoint: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`, dsn: `${u.protocol}//${u.username}@${u.host}${prefix}/${project}` }
  } catch {
    return null
  }
}

export interface ErrorContext {
  requestId?: string
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined> | Headers
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  level?: 'error' | 'warning' | 'fatal'
}

export interface ErrorTrackerOptions {
  dsn?: string
  app: string
  release?: string
  environment?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export interface ErrorTracker {
  readonly enabled: boolean
  captureException(err: unknown, ctx?: ErrorContext): string | null
  /** Resolves when pending sends settle, for shutdown and tests. */
  flush(): Promise<void>
}

function frames(stack: string | undefined) {
  if (!stack) return undefined
  const out: Array<{ function?: string; filename?: string; lineno?: number; colno?: number }> = []
  for (const line of stack.split('\n').slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line)
    if (m) out.push({ function: m[1], filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) })
  }
  return out.length ? { frames: out.reverse() } : undefined
}

export function buildEvent(err: unknown, opts: ErrorTrackerOptions, ctx: ErrorContext = {}, eventId = randomBytes(16).toString('hex')) {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown')
  const tags: Record<string, string> = { app: opts.app, ...(ctx.tags ?? {}) }
  if (ctx.requestId) tags.request_id = ctx.requestId
  return {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: ctx.level ?? 'error',
    release: opts.release,
    environment: opts.environment,
    server_name: opts.app,
    tags,
    exception: { values: [{ type: e.name, value: scrubText(e.message), stacktrace: frames(e.stack) }] },
    request: ctx.url || ctx.method || ctx.headers
      ? { method: ctx.method, url: ctx.url ? scrubUrl(ctx.url) : undefined, headers: ctx.headers ? scrubHeaders(ctx.headers) : undefined }
      : undefined,
    extra: ctx.extra ? scrubValue(ctx.extra) : undefined,
  }
}

export function createErrorTracker(opts: ErrorTrackerOptions): ErrorTracker {
  const parsed = parseDsn(opts.dsn)
  if (!parsed) return { enabled: false, captureException: () => null, flush: async () => {} }
  const doFetch = opts.fetch ?? fetch
  const pending = new Set<Promise<unknown>>()
  return {
    enabled: true,
    captureException(err, ctx) {
      try {
        const event = buildEvent(err, opts, ctx)
        const body = [
          JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: parsed.dsn }),
          JSON.stringify({ type: 'event' }),
          JSON.stringify(event),
        ].join('\n')
        const p = doFetch(parsed.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-sentry-envelope',
            'x-sentry-auth': `Sentry sentry_version=7, sentry_client=blueyvatar/0.0.0, sentry_key=${parsed.key}`,
          },
          body,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
        }).then((r) => r.arrayBuffer()).catch(() => {})
        pending.add(p)
        void p.finally(() => pending.delete(p))
        return event.event_id
      } catch {
        return null
      }
    },
    flush: async () => { await Promise.all([...pending]) },
  }
}
