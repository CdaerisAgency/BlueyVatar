import { scrubValue } from './scrub.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  /** Same logger with extra fields on every line, such as a request id. */
  child(fields: Record<string, unknown>): Logger
}

export interface LoggerOptions {
  /** App name on every line: web, delivery, or indexer. */
  app: string
  /** Minimum level. Defaults to LOG_LEVEL, then info. */
  level?: LogLevel
  /** Output sink. Defaults to one JSON line per call on the console method for the level. */
  write?: (level: LogLevel, line: string) => void
  now?: () => Date
}

function envLevel(): LogLevel {
  const v = (typeof process !== 'undefined' ? process.env.LOG_LEVEL : undefined)?.toLowerCase()
  return v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : 'info'
}

function defaultWrite(level: LogLevel, line: string): void {
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/**
 * Structured JSON logger. Each line has `level`, `app`, `msg`, and `time`, plus the fields passed in.
 * Fields are scrubbed: a `did` becomes `didHash`, keys that look like credentials or email are
 * replaced, and emails or bearer values inside strings are masked. Raw email and tokens never land in logs.
 */
export function createLogger(opts: LoggerOptions, base: Record<string, unknown> = {}): Logger {
  const min = ORDER[opts.level ?? envLevel()]
  const write = opts.write ?? defaultWrite
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < min) return
    const line = {
      level,
      app: opts.app,
      msg: scrubValue(msg),
      time: (opts.now?.() ?? new Date()).toISOString(),
      ...(scrubValue({ ...base, ...fields }) as Record<string, unknown>),
    }
    try {
      write(level, JSON.stringify(line))
    } catch {
      /* logging must never throw */
    }
  }
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger(opts, { ...base, ...fields }),
  }
}
