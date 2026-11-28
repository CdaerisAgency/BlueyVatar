import { SettingsCache } from '@blueyvatar/core/settings-cache'
import type { SiteSettings } from '@blueyvatar/core/settings'
import { listSettingRows } from './setting-rows'
import { formatVolume } from './format-volume'
import { log } from './obs'
import { getPool } from './pool'

/**
 * Live admin settings for the web app: public copy, keys and billing pages. One cache per process on globalThis
 * (Next can load this module in more than one bundle). Without DATABASE_URL, or while the database is unreachable,
 * the defaults apply. Refresh runs every SETTINGS_REFRESH_MS (default 60000).
 */
interface Holder { cache: SettingsCache; started: Promise<void> }
const g = globalThis as { __bvSettings?: Holder }

function refreshMs(): number {
  const n = Number(process.env.SETTINGS_REFRESH_MS)
  return Number.isFinite(n) && n >= 1000 ? n : 60_000
}

export async function getSiteSettings(): Promise<SiteSettings> {
  if (!g.__bvSettings) {
    const pool = getPool()
    const cache = new SettingsCache(pool ? () => listSettingRows(pool) : null, {
      refreshMs: refreshMs(),
      onError: (err) => log.error('settings refresh failed', { err }),
      onRejected: (keys) => log.warn('settings rows rejected', { keys }),
    })
    g.__bvSettings = { cache, started: cache.start() }
  }
  await g.__bvSettings.started
  return g.__bvSettings.cache.current()
}

export { formatVolume }
