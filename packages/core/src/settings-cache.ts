/**
 * Synchronous read-through cache of admin settings, refreshed from the database in the background.
 * Used by the image server and the web app. A failed refresh keeps the last good snapshot.
 * Import by subpath: `@blueyvatar/core/settings-cache`.
 */
import { DEFAULT_SETTINGS, parseSettings, type SettingRow, type SiteSettings } from './settings.js'

export interface SettingsCacheOptions {
  refreshMs?: number
  onError?: (err: unknown) => void
  onRejected?: (keys: string[]) => void
}

const DEFAULT_REFRESH_MS = 60_000

export class SettingsCache {
  private snapshot: SiteSettings = DEFAULT_SETTINGS
  private timer: ReturnType<typeof setInterval> | null = null
  private inflight: Promise<void> | null = null
  private readonly refreshMs: number

  constructor(
    private readonly load: (() => Promise<SettingRow[]>) | null,
    private readonly opts: SettingsCacheOptions = {},
  ) {
    this.refreshMs = opts.refreshMs ?? DEFAULT_REFRESH_MS
  }

  /** Loads once (never rejects), then refreshes on an unref()ed interval. */
  async start(): Promise<void> {
    if (!this.load) return
    await this.refresh()
    if (this.timer) return
    this.timer = setInterval(() => { void this.refresh() }, this.refreshMs)
    this.timer.unref()
  }

  /** Reloads from the database. Never rejects; failures go to onError. Shares an in-flight load. */
  refresh(): Promise<void> {
    if (!this.load) return Promise.resolve()
    if (this.inflight) return this.inflight
    const load = this.load
    this.inflight = (async () => {
      try {
        const { settings, rejected } = parseSettings(await load())
        this.snapshot = settings
        if (rejected.length > 0) this.opts.onRejected?.(rejected)
      } catch (err) {
        this.opts.onError?.(err)
      } finally {
        this.inflight = null
      }
    })()
    return this.inflight
  }

  current(): SiteSettings {
    return this.snapshot
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
