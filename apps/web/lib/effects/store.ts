import type pg from 'pg'
import { singleton } from '../pool'

/** One account's effects state (migration 0041). A missing row means no frame and no out-of-office window. */
export type AwayState = 'off' | 'scheduled' | 'active' | 'failed'
export type EffectsRow = {
  did: string
  frameStyle: string | null
  frameColor: string | null
  frameSourceRkey: string | null
  frameImageRkey: string | null
  /** Image filter id (migration 0042). With frameStyle, this is the one look; the render is frameImageRkey. */
  filterId: string | null
  awayState: AwayState
  awayStartOn: string | null
  awayEndOn: string | null
  awayTimezone: string | null
  awayStartAt: Date | null
  awayEndAt: Date | null
  awayImageRkey: string | null
  awayPrevDefaultRkey: string | null
  awayError: string | null
  awayRetryAt: Date | null
}

export const emptyRow = (did: string): EffectsRow => ({
  did, frameStyle: null, frameColor: null, frameSourceRkey: null, frameImageRkey: null, filterId: null,
  awayState: 'off', awayStartOn: null, awayEndOn: null, awayTimezone: null, awayStartAt: null, awayEndAt: null,
  awayImageRkey: null, awayPrevDefaultRkey: null, awayError: null, awayRetryAt: null,
})

export interface EffectsStore {
  get(did: string): Promise<EffectsRow>
  /** Merge the given fields into the row, creating it when missing. */
  patch(did: string, fields: Partial<Omit<EffectsRow, 'did'>>): Promise<EffectsRow>
}

export function memoryEffectsStore(): EffectsStore & { rows: Map<string, EffectsRow> } {
  const rows = new Map<string, EffectsRow>()
  return {
    rows,
    async get(did) {
      return { ...(rows.get(did) ?? emptyRow(did)) }
    },
    async patch(did, fields) {
      const next = { ...(rows.get(did) ?? emptyRow(did)), ...fields, did }
      rows.set(did, next)
      return { ...next }
    },
  }
}

const COLUMNS: Record<keyof Omit<EffectsRow, 'did'>, string> = {
  frameStyle: 'frame_style', frameColor: 'frame_color', frameSourceRkey: 'frame_source_rkey', frameImageRkey: 'frame_image_rkey', filterId: 'filter_id',
  awayState: 'away_state', awayStartOn: 'away_start_on', awayEndOn: 'away_end_on', awayTimezone: 'away_timezone',
  awayStartAt: 'away_start_at', awayEndAt: 'away_end_at', awayImageRkey: 'away_image_rkey',
  awayPrevDefaultRkey: 'away_prev_default_rkey', awayError: 'away_error', awayRetryAt: 'away_retry_at',
}

const SELECT = `SELECT did, frame_style, frame_color, frame_source_rkey, frame_image_rkey, filter_id, away_state,
  to_char(away_start_on, 'YYYY-MM-DD') AS away_start_on, to_char(away_end_on, 'YYYY-MM-DD') AS away_end_on, away_timezone,
  away_start_at, away_end_at, away_image_rkey, away_prev_default_rkey, away_error, away_retry_at FROM avatar_effects WHERE did = $1`

type DbRow = Record<string, unknown>
const fromDb = (r: DbRow): EffectsRow => ({
  did: r.did as string,
  frameStyle: (r.frame_style as string | null) ?? null,
  frameColor: (r.frame_color as string | null) ?? null,
  frameSourceRkey: (r.frame_source_rkey as string | null) ?? null,
  frameImageRkey: (r.frame_image_rkey as string | null) ?? null,
  filterId: (r.filter_id as string | null) ?? null,
  awayState: r.away_state as AwayState,
  awayStartOn: (r.away_start_on as string | null) ?? null,
  awayEndOn: (r.away_end_on as string | null) ?? null,
  awayTimezone: (r.away_timezone as string | null) ?? null,
  awayStartAt: (r.away_start_at as Date | null) ?? null,
  awayEndAt: (r.away_end_at as Date | null) ?? null,
  awayImageRkey: (r.away_image_rkey as string | null) ?? null,
  awayPrevDefaultRkey: (r.away_prev_default_rkey as string | null) ?? null,
  awayError: (r.away_error as string | null) ?? null,
  awayRetryAt: (r.away_retry_at as Date | null) ?? null,
})

export function pgEffectsStore(pool: Pick<pg.Pool, 'query'>): EffectsStore {
  const store: EffectsStore = {
    async get(did) {
      const { rows } = await pool.query(SELECT, [did])
      return rows[0] ? fromDb(rows[0]) : emptyRow(did)
    },
    async patch(did, fields) {
      const keys = (Object.keys(fields) as (keyof typeof COLUMNS)[]).filter((k) => k in COLUMNS)
      const cols = keys.map((k) => COLUMNS[k])
      const vals = keys.map((k) => fields[k] ?? null)
      const insert = ['did', ...cols].join(', ')
      const marks = ['$1', ...cols.map((_, i) => `$${i + 2}`)].join(', ')
      const set = [...cols.map((c) => `${c} = EXCLUDED.${c}`), 'updated_at = now()'].join(', ')
      await pool.query(`INSERT INTO avatar_effects (${insert}) VALUES (${marks}) ON CONFLICT (did) DO UPDATE SET ${set}`, [did, ...vals])
      return store.get(did)
    },
  }
  return store
}

export function getEffectsStore(): EffectsStore {
  return singleton('__bvEffects', pgEffectsStore, memoryEffectsStore)
}
