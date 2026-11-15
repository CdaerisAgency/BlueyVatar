import type pg from 'pg'
import type { BlobRef } from './repo'
import { getPool } from './store'

/**
 * Per-account, per-app state for the avatar push (migrations 0033 and 0039). The tables keep their original
 * names (`bsky_avatar_sync`, `bsky_avatar_log`) so the account export and delete code keeps working. No row means
 * the defaults: the app is off, because nothing is pushed until the user ticks its box.
 */
export type PushState = {
  /** The user ticked the box and finished the consent step. Pushes on default-image changes happen only when true. */
  enabled: boolean
  /** The user agreed to create the app's profile record, holding only the picture, if it does not exist. Set with the box, cleared when the box is unticked. */
  mayCreate: boolean
  /** When the user last started the consent step for this app, or null. It lets the page pick up where the user left off after the permission screen. */
  consentStartedAt: Date | null
  /** Undefined when there is nothing to restore; null when the profile had no avatar before the last change. */
  previous: BlobRef | null | undefined
  lastSourceCid: string | null
  lastSentCid: string | null
  autoNoticePending: boolean
}
export const DEFAULT_PUSH_STATE: PushState = { enabled: false, mayCreate: false, consentStartedAt: null, previous: undefined, lastSourceCid: null, lastSentCid: null, autoNoticePending: false }

/** How long a started consent step stays open for the user to come back to it. */
export const CONSENT_WINDOW_MS = 30 * 60 * 1000

export type LogAction = 'set' | 'auto_set' | 'restore'
export type LogEntry = { did: string; app: string; action: LogAction; fromCid: string | null; toCid: string | null; sourceCid: string | null; at: Date }

export interface PushStore {
  get(did: string, app: string): Promise<PushState>
  /** The ids of the apps the user turned on. */
  enabledApps(did: string): Promise<string[]>
  setEnabled(did: string, app: string, on: boolean, mayCreate?: boolean): Promise<void>
  startConsent(did: string, app: string): Promise<void>
  clearConsent(did: string, app: string): Promise<void>
  /** Records a successful change: the previous avatar, what was sent, the audit row, and the first-automatic-change notice. */
  recordChange(did: string, app: string, e: { action: LogAction; previous: BlobRef | null; sentCid: string | null; sourceCid: string | null }): Promise<void>
  clearPrevious(did: string, app: string): Promise<void>
  dismissNotice(did: string, app: string): Promise<void>
  log(did: string, app?: string): Promise<LogEntry[]>
}

type Row = PushState & { autoCount: number }

export function memoryPushStore(clock: () => Date = () => new Date()): PushStore {
  const rows = new Map<string, Row>()
  const logs: LogEntry[] = []
  const key = (did: string, app: string) => `${did}\u0000${app}`
  const row = (did: string, app: string): Row => rows.get(key(did, app)) ?? { ...DEFAULT_PUSH_STATE, autoCount: 0 }
  const put = (did: string, app: string, r: Row) => void rows.set(key(did, app), r)
  return {
    async get(did, app) {
      const { autoCount: _n, ...s } = row(did, app)
      return s
    },
    async enabledApps(did) {
      return [...rows.entries()].filter(([k, r]) => k.startsWith(`${did}\u0000`) && r.enabled).map(([k]) => k.slice(did.length + 1))
    },
    async setEnabled(did, app, on, mayCreate = false) {
      put(did, app, { ...row(did, app), enabled: on, mayCreate: on && mayCreate, consentStartedAt: on ? null : row(did, app).consentStartedAt })
    },
    async startConsent(did, app) {
      put(did, app, { ...row(did, app), consentStartedAt: clock() })
    },
    async clearConsent(did, app) {
      put(did, app, { ...row(did, app), consentStartedAt: null })
    },
    async recordChange(did, app, e) {
      const r = row(did, app)
      const first = e.action === 'auto_set' && r.autoCount === 0
      const fromCid = e.action === 'restore' ? r.lastSentCid : (e.previous?.ref.$link ?? null)
      // A restore uses up the saved previous avatar; any other change replaces it.
      put(did, app, {
        ...r,
        previous: e.action === 'restore' ? undefined : e.previous,
        lastSentCid: e.sentCid,
        lastSourceCid: e.action === 'restore' ? null : e.sourceCid,
        autoNoticePending: r.autoNoticePending || first,
        autoCount: r.autoCount + (e.action === 'auto_set' ? 1 : 0),
      })
      logs.push({ did, app, action: e.action, fromCid, toCid: e.sentCid, sourceCid: e.sourceCid, at: clock() })
    },
    async clearPrevious(did, app) {
      put(did, app, { ...row(did, app), previous: undefined })
    },
    async dismissNotice(did, app) {
      put(did, app, { ...row(did, app), autoNoticePending: false })
    },
    async log(did, app) {
      return logs.filter((l) => l.did === did && (app === undefined || l.app === app))
    },
  }
}

type DbRow = {
  enabled: boolean
  may_create: boolean
  consent_started_at: Date | null
  previous_avatar: BlobRef | null
  has_previous: boolean
  last_source_cid: string | null
  last_sent_cid: string | null
  auto_notice_pending: boolean
}

export function pgPushStore(pool: Pick<pg.Pool, 'query'>): PushStore {
  return {
    async get(did, app) {
      const { rows } = await pool.query<DbRow>(
        'SELECT enabled, may_create, consent_started_at, previous_avatar, has_previous, last_source_cid, last_sent_cid, auto_notice_pending FROM bsky_avatar_sync WHERE did = $1 AND app = $2',
        [did, app],
      )
      const r = rows[0]
      if (!r) return { ...DEFAULT_PUSH_STATE }
      return {
        enabled: r.enabled,
        mayCreate: r.may_create,
        consentStartedAt: r.consent_started_at,
        previous: r.has_previous ? r.previous_avatar : undefined,
        lastSourceCid: r.last_source_cid,
        lastSentCid: r.last_sent_cid,
        autoNoticePending: r.auto_notice_pending,
      }
    },
    async enabledApps(did) {
      const { rows } = await pool.query<{ app: string }>('SELECT app FROM bsky_avatar_sync WHERE did = $1 AND enabled ORDER BY app', [did])
      return rows.map((r) => r.app)
    },
    async setEnabled(did, app, on, mayCreate = false) {
      await pool.query(
        `INSERT INTO bsky_avatar_sync (did, app, enabled, may_create) VALUES ($1, $2, $3, $4)
         ON CONFLICT (did, app) DO UPDATE SET enabled = $3, may_create = $4, consent_started_at = CASE WHEN $3 THEN NULL ELSE bsky_avatar_sync.consent_started_at END, updated_at = now()`,
        [did, app, on, on && mayCreate],
      )
    },
    async startConsent(did, app) {
      await pool.query(
        'INSERT INTO bsky_avatar_sync (did, app, consent_started_at) VALUES ($1, $2, now()) ON CONFLICT (did, app) DO UPDATE SET consent_started_at = now(), updated_at = now()',
        [did, app],
      )
    },
    async clearConsent(did, app) {
      await pool.query('UPDATE bsky_avatar_sync SET consent_started_at = NULL, updated_at = now() WHERE did = $1 AND app = $2', [did, app])
    },
    async recordChange(did, app, e) {
      const restore = e.action === 'restore'
      const auto = e.action === 'auto_set'
      const before = await pool.query<{ last_sent_cid: string | null }>('SELECT last_sent_cid FROM bsky_avatar_sync WHERE did = $1 AND app = $2', [did, app])
      const fromCid = restore ? (before.rows[0]?.last_sent_cid ?? null) : (e.previous?.ref.$link ?? null)
      await pool.query(
        `INSERT INTO bsky_avatar_sync (did, app, previous_avatar, has_previous, last_source_cid, last_sent_cid, auto_notice_pending, auto_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (did, app) DO UPDATE SET
           previous_avatar = $3, has_previous = $4, last_source_cid = $5, last_sent_cid = $6,
           auto_notice_pending = bsky_avatar_sync.auto_notice_pending OR (CASE WHEN $9 THEN bsky_avatar_sync.auto_count = 0 ELSE false END),
           auto_count = bsky_avatar_sync.auto_count + $8, updated_at = now()`,
        [did, app, restore ? null : JSON.stringify(e.previous), !restore, restore ? null : e.sourceCid, e.sentCid, auto, auto ? 1 : 0, auto],
      )
      await pool.query('INSERT INTO bsky_avatar_log (did, app, action, from_cid, to_cid, source_cid) VALUES ($1, $2, $3, $4, $5, $6)', [did, app, e.action, fromCid, e.sentCid, e.sourceCid])
    },
    async clearPrevious(did, app) {
      await pool.query('UPDATE bsky_avatar_sync SET previous_avatar = NULL, has_previous = false, updated_at = now() WHERE did = $1 AND app = $2', [did, app])
    },
    async dismissNotice(did, app) {
      await pool.query('UPDATE bsky_avatar_sync SET auto_notice_pending = false, updated_at = now() WHERE did = $1 AND app = $2', [did, app])
    },
    async log(did, app) {
      const { rows } = await pool.query(
        app === undefined
          ? 'SELECT app, action, from_cid, to_cid, source_cid, created_at FROM bsky_avatar_log WHERE did = $1 ORDER BY id'
          : 'SELECT app, action, from_cid, to_cid, source_cid, created_at FROM bsky_avatar_log WHERE did = $1 AND app = $2 ORDER BY id',
        app === undefined ? [did] : [did, app],
      )
      return rows.map((r) => ({ did, app: r.app, action: r.action, fromCid: r.from_cid, toCid: r.to_cid, sourceCid: r.source_cid, at: r.created_at }))
    },
  }
}

type G = typeof globalThis & { __bvPushStore?: PushStore }
export function getPushStore(): PushStore {
  const g = globalThis as G
  const pool = getPool()
  g.__bvPushStore ??= pool ? pgPushStore(pool) : memoryPushStore()
  return g.__bvPushStore
}
