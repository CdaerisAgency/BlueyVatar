import type pg from 'pg'
import type { BlobRef } from './repo'
import { getPool } from './store'

/** Per-account state for the Bluesky avatar sync (migration 0033). No state means the defaults. */
export type SyncState = {
  autoSync: boolean
  /** Undefined when there is nothing to restore; null when the profile had no avatar before the last change. */
  previous: BlobRef | null | undefined
  lastSourceCid: string | null
  lastSentCid: string | null
  autoNoticePending: boolean
}
export const DEFAULT_SYNC_STATE: SyncState = { autoSync: true, previous: undefined, lastSourceCid: null, lastSentCid: null, autoNoticePending: false }

export type LogAction = 'set' | 'auto_set' | 'restore'
export type LogEntry = { did: string; action: LogAction; fromCid: string | null; toCid: string | null; sourceCid: string | null; at: Date }

export interface SyncStore {
  get(did: string): Promise<SyncState>
  setAutoSync(did: string, on: boolean): Promise<void>
  /** Records a successful change: the previous avatar, what was sent, the audit row, and the first-automatic-change notice. */
  recordChange(did: string, e: { action: LogAction; previous: BlobRef | null; sentCid: string | null; sourceCid: string | null }): Promise<void>
  clearPrevious(did: string): Promise<void>
  dismissNotice(did: string): Promise<void>
  log(did: string): Promise<LogEntry[]>
}

export function memorySyncStore(clock: () => Date = () => new Date()): SyncStore {
  const rows = new Map<string, SyncState & { autoCount: number }>()
  const logs: LogEntry[] = []
  const row = (did: string) => rows.get(did) ?? { ...DEFAULT_SYNC_STATE, autoCount: 0 }
  return {
    async get(did) {
      const { autoCount: _n, ...s } = row(did)
      return s
    },
    async setAutoSync(did, on) {
      rows.set(did, { ...row(did), autoSync: on })
    },
    async recordChange(did, e) {
      const r = row(did)
      const first = e.action === 'auto_set' && r.autoCount === 0
      const fromCid = e.action === 'restore' ? r.lastSentCid : (e.previous?.ref.$link ?? null)
      // A restore uses up the saved previous avatar; any other change replaces it.
      rows.set(did, {
        ...r,
        previous: e.action === 'restore' ? undefined : e.previous,
        lastSentCid: e.sentCid,
        lastSourceCid: e.action === 'restore' ? null : e.sourceCid,
        autoNoticePending: r.autoNoticePending || first,
        autoCount: r.autoCount + (e.action === 'auto_set' ? 1 : 0),
      })
      logs.push({ did, action: e.action, fromCid, toCid: e.sentCid, sourceCid: e.sourceCid, at: clock() })
    },
    async clearPrevious(did) {
      rows.set(did, { ...row(did), previous: undefined })
    },
    async dismissNotice(did) {
      rows.set(did, { ...row(did), autoNoticePending: false })
    },
    async log(did) {
      return logs.filter((l) => l.did === did)
    },
  }
}

type Row = { auto_sync: boolean; previous_avatar: BlobRef | null; has_previous: boolean; last_source_cid: string | null; last_sent_cid: string | null; auto_notice_pending: boolean }

export function pgSyncStore(pool: Pick<pg.Pool, 'query'>): SyncStore {
  return {
    async get(did) {
      const { rows } = await pool.query<Row>('SELECT auto_sync, previous_avatar, has_previous, last_source_cid, last_sent_cid, auto_notice_pending FROM bsky_avatar_sync WHERE did = $1', [did])
      const r = rows[0]
      if (!r) return { ...DEFAULT_SYNC_STATE }
      return {
        autoSync: r.auto_sync,
        previous: r.has_previous ? r.previous_avatar : undefined,
        lastSourceCid: r.last_source_cid,
        lastSentCid: r.last_sent_cid,
        autoNoticePending: r.auto_notice_pending,
      }
    },
    async setAutoSync(did, on) {
      await pool.query('INSERT INTO bsky_avatar_sync (did, auto_sync) VALUES ($1, $2) ON CONFLICT (did) DO UPDATE SET auto_sync = $2, updated_at = now()', [did, on])
    },
    async recordChange(did, e) {
      const restore = e.action === 'restore'
      const auto = e.action === 'auto_set'
      const before = await pool.query<{ last_sent_cid: string | null }>('SELECT last_sent_cid FROM bsky_avatar_sync WHERE did = $1', [did])
      const fromCid = restore ? (before.rows[0]?.last_sent_cid ?? null) : (e.previous?.ref.$link ?? null)
      await pool.query(
        `INSERT INTO bsky_avatar_sync (did, previous_avatar, has_previous, last_source_cid, last_sent_cid, auto_notice_pending, auto_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (did) DO UPDATE SET
           previous_avatar = $2, has_previous = $3, last_source_cid = $4, last_sent_cid = $5,
           auto_notice_pending = bsky_avatar_sync.auto_notice_pending OR (CASE WHEN $8 THEN bsky_avatar_sync.auto_count = 0 ELSE false END),
           auto_count = bsky_avatar_sync.auto_count + $7, updated_at = now()`,
        [did, restore ? null : JSON.stringify(e.previous), !restore, restore ? null : e.sourceCid, e.sentCid, auto, auto ? 1 : 0, auto],
      )
      await pool.query('INSERT INTO bsky_avatar_log (did, action, from_cid, to_cid, source_cid) VALUES ($1, $2, $3, $4, $5)', [did, e.action, fromCid, e.sentCid, e.sourceCid])
    },
    async clearPrevious(did) {
      await pool.query('UPDATE bsky_avatar_sync SET previous_avatar = NULL, has_previous = false, updated_at = now() WHERE did = $1', [did])
    },
    async dismissNotice(did) {
      await pool.query('UPDATE bsky_avatar_sync SET auto_notice_pending = false, updated_at = now() WHERE did = $1', [did])
    },
    async log(did) {
      const { rows } = await pool.query('SELECT action, from_cid, to_cid, source_cid, created_at FROM bsky_avatar_log WHERE did = $1 ORDER BY id', [did])
      return rows.map((r) => ({ did, action: r.action, fromCid: r.from_cid, toCid: r.to_cid, sourceCid: r.source_cid, at: r.created_at }))
    },
  }
}

type G = typeof globalThis & { __bvBskySync?: SyncStore }
export function getSyncStore(): SyncStore {
  const g = globalThis as G
  const pool = getPool()
  g.__bvBskySync ??= pool ? pgSyncStore(pool) : memorySyncStore()
  return g.__bvBskySync
}
