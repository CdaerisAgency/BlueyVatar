import type pg from 'pg'
import { emptyHolidaySettings, parseHolidaySettings, parseSchedule, type HolidaySettings, type Schedule } from '@blueyvatar/core'
import { singleton } from '../pool'

/** One account's avatar calendar (migration 0044). A missing row means no calendar. */
export type ScheduleState = 'idle' | 'applied' | 'failed'
export type ScheduleRow = {
  did: string
  schedule: Schedule
  /** Holiday country, region and picks (migration 0045, issue #220). */
  holidays: HolidaySettings
  timezone: string
  nextChangeAt: Date | null
  state: ScheduleState
  appliedImage: string | null
  appliedDefault: string | null
  prevDefault: string | null
  prevLookSource: string | null
  lastError: string | null
}

export type SchedulePatch = Partial<Omit<ScheduleRow, 'did'>>

export interface ScheduleStore {
  get(did: string): Promise<ScheduleRow | null>
  /** Merge the given fields into the row, creating it when missing (a new row needs `timezone`). */
  patch(did: string, fields: SchedulePatch): Promise<ScheduleRow>
  /**
   * Claims a due row: when next_change_at is set and not after `now`, moves it to `until` and returns true.
   * Two overlapping ticks for one account cannot both get true.
   */
  lease(did: string, now: Date, until: Date): Promise<boolean>
  delete(did: string): Promise<void>
}

const blank = (did: string, timezone: string): ScheduleRow => ({
  did, schedule: { dates: [], weekly: [] }, holidays: emptyHolidaySettings(), timezone, nextChangeAt: null, state: 'idle',
  appliedImage: null, appliedDefault: null, prevDefault: null, prevLookSource: null, lastError: null,
})

export function memoryScheduleStore(): ScheduleStore & { rows: Map<string, ScheduleRow> } {
  const rows = new Map<string, ScheduleRow>()
  const copy = (r: ScheduleRow): ScheduleRow => ({ ...r, schedule: parseSchedule(r.schedule), holidays: parseHolidaySettings(r.holidays) })
  return {
    rows,
    async get(did) {
      const r = rows.get(did)
      return r ? copy(r) : null
    },
    async patch(did, fields) {
      const base = rows.get(did) ?? blank(did, fields.timezone ?? '')
      const next = { ...base, ...fields, did }
      rows.set(did, next)
      return copy(next)
    },
    async lease(did, now, until) {
      const r = rows.get(did)
      if (!r || !r.nextChangeAt || r.nextChangeAt > now) return false
      rows.set(did, { ...r, nextChangeAt: until })
      return true
    },
    async delete(did) {
      rows.delete(did)
    },
  }
}

const COLUMNS: Record<keyof Omit<ScheduleRow, 'did'>, string> = {
  schedule: 'schedule', holidays: 'holidays', timezone: 'timezone', nextChangeAt: 'next_change_at', state: 'state', appliedImage: 'applied_image',
  appliedDefault: 'applied_default', prevDefault: 'prev_default', prevLookSource: 'prev_look_source', lastError: 'last_error',
}

const SELECT = `SELECT did, schedule, holidays, timezone, next_change_at, state, applied_image, applied_default, prev_default, prev_look_source, last_error
  FROM avatar_schedule WHERE did = $1`

type DbRow = Record<string, unknown>
const fromDb = (r: DbRow): ScheduleRow => ({
  did: r.did as string,
  schedule: parseSchedule(r.schedule),
  holidays: parseHolidaySettings(r.holidays),
  timezone: r.timezone as string,
  nextChangeAt: (r.next_change_at as Date | null) ?? null,
  state: r.state as ScheduleState,
  appliedImage: (r.applied_image as string | null) ?? null,
  appliedDefault: (r.applied_default as string | null) ?? null,
  prevDefault: (r.prev_default as string | null) ?? null,
  prevLookSource: (r.prev_look_source as string | null) ?? null,
  lastError: (r.last_error as string | null) ?? null,
})

export function pgScheduleStore(pool: Pick<pg.Pool, 'query'>): ScheduleStore {
  const store: ScheduleStore = {
    async get(did) {
      const { rows } = await pool.query(SELECT, [did])
      return rows[0] ? fromDb(rows[0]) : null
    },
    async patch(did, fields) {
      const keys = (Object.keys(fields) as (keyof typeof COLUMNS)[]).filter((k) => k in COLUMNS)
      const cols = keys.map((k) => COLUMNS[k])
      const vals = keys.map((k) => (k === 'schedule' || k === 'holidays' ? JSON.stringify(fields[k]) : (fields[k] ?? null)))
      const insert = ['did', ...cols].join(', ')
      const marks = ['$1', ...cols.map((c, i) => (c === 'schedule' || c === 'holidays' ? `$${i + 2}::jsonb` : `$${i + 2}`))].join(', ')
      const set = [...cols.map((c) => `${c} = EXCLUDED.${c}`), 'updated_at = now()'].join(', ')
      await pool.query(`INSERT INTO avatar_schedule (${insert}) VALUES (${marks}) ON CONFLICT (did) DO UPDATE SET ${set}`, [did, ...vals])
      return (await store.get(did))!
    },
    async lease(did, now, until) {
      const r = await pool.query('UPDATE avatar_schedule SET next_change_at = $3, updated_at = now() WHERE did = $1 AND next_change_at IS NOT NULL AND next_change_at <= $2', [did, now, until])
      return (r.rowCount ?? 0) > 0
    },
    async delete(did) {
      await pool.query('DELETE FROM avatar_schedule WHERE did = $1', [did])
    },
  }
  return store
}

export function getScheduleStore(): ScheduleStore {
  return singleton('__bvSchedule', pgScheduleStore, memoryScheduleStore)
}
