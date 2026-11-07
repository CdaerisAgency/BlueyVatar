import type pg from 'pg'
import { ENFORCED_LABELS, REMOVE_LABELS, HIDE_LABEL, RATING_LABELS, labelSubjectDid } from '@blueyvatar/core'
import { log, metrics } from './obs.js'

/**
 * atproto label consumption (issue #207). Spec: https://atproto.com/specs/label
 * Labels arrive from com.atproto.label.subscribeLabels on each configured labeler. Only values blueyvatar
 * enforces are stored (see ENFORCED_LABELS). A negation deletes the stored label. LIMITATION: label
 * signatures are not verified; the stream is trusted because its URL comes from the labeler's DID document
 * over TLS and every label's `src` must equal the configured labeler DID.
 */
export interface Label {
  src: string
  uri: string
  cid?: string
  val: string
  neg?: boolean
  cts: string
  exp?: string
}
export interface LabelFrame { seq: number; labels: Label[] }
/** Yields frames starting after `cursor`. Ends or throws when the connection drops; the caller reconnects. */
export type LabelSource = (cursor: number) => AsyncIterable<LabelFrame>

export interface LabelStore {
  getCursor(src: string): Promise<number>
  /** Applies one frame's labels and advances the cursor in one step. */
  applyFrame(src: string, frame: LabelFrame, now?: Date): Promise<{ stored: number; removed: number; queued: number }>
}

const REMOVAL = new Set<string>([...REMOVE_LABELS, HIDE_LABEL])
const RATING = new Set<string>(RATING_LABELS)

function describe(l: Label): { reason: 'explicit' | 'other'; details: string } {
  const what = RATING.has(l.val) ? `rating label "${l.val}"` : `label "${l.val}"`
  return { reason: RATING.has(l.val) ? 'explicit' : 'other', details: `Automatic review item: labeler ${l.src} applied ${what} to ${l.uri}.` }
}

export class PgLabelStore implements LabelStore {
  /** onRemoved purges cached images of a DID after a removal label lands (best effort). */
  constructor(private pool: pg.Pool, private opts: { onRemoved?: (did: string, cids: string[]) => Promise<void> } = {}) {}

  async getCursor(src: string): Promise<number> {
    const { rows } = await this.pool.query<{ cursor: string }>('SELECT cursor FROM label_cursors WHERE src = $1', [src])
    return rows[0] ? Number(rows[0].cursor) : 0
  }

  async applyFrame(src: string, frame: LabelFrame, now = new Date()) {
    const out = { stored: 0, removed: 0, queued: 0 }
    const purge = new Set<string>()
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      for (const l of frame.labels) {
        const did = labelSubjectDid(l.uri)
        if (l.src !== src || !did || !ENFORCED_LABELS.includes(l.val)) continue
        if (l.neg) {
          await c.query('DELETE FROM moderation_labels WHERE src = $1 AND subject = $2 AND val = $3', [src, l.uri, l.val])
          continue
        }
        if (l.exp && new Date(l.exp) <= now) continue
        const { rows } = await c.query<{ inserted: boolean }>(
          `INSERT INTO moderation_labels (src, subject, subject_did, cid, val, cts, exp) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (src, subject, val) DO UPDATE SET cid = EXCLUDED.cid, cts = EXCLUDED.cts, exp = EXCLUDED.exp
           RETURNING (xmax = 0) AS inserted`,
          [src, l.uri, did, l.cid ?? null, l.val, l.cts, l.exp ?? null],
        )
        out.stored++
        if (!rows[0]?.inserted) continue
        const d = describe(l)
        const key = `${src}|${l.uri}|${l.val}`
        const q = await c.query(
          `INSERT INTO reports (target_did, source, reason, details, reporter_contact, ip_hash, origin, label_key)
           VALUES ($1, 'avatar', $2, $3, NULL, 'label', 'label', $4)
           ON CONFLICT (label_key) WHERE status = 'open' AND label_key IS NOT NULL DO NOTHING`,
          [did, d.reason, d.details, key],
        )
        out.queued += q.rowCount ?? 0
        if (REMOVAL.has(l.val)) { out.removed++; purge.add(did) }
      }
      await c.query(
        `INSERT INTO label_cursors (src, cursor) VALUES ($1, $2)
         ON CONFLICT (src) DO UPDATE SET cursor = GREATEST(label_cursors.cursor, EXCLUDED.cursor), updated_at = now()`,
        [src, frame.seq],
      )
      await c.query('COMMIT')
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      c.release()
    }
    for (const did of purge) {
      const { rows } = await this.pool.query<{ cid: string }>('SELECT DISTINCT cid FROM images WHERE did = $1', [did])
      this.opts.onRemoved?.(did, rows.map((r) => r.cid)).catch((err) => log.warn('label purge failed', { err }))
    }
    return out
  }
}

export interface RunOptions {
  /** Stops the loop when it returns true. Checked between frames and reconnects. */
  stopped?: () => boolean
  sleep?: (ms: number) => Promise<void>
  maxBackoffMs?: number
}

/** Consumes one labeler forever: resume from the stored cursor, apply each frame, reconnect with backoff. */
export async function runLabeler(src: string, source: LabelSource, store: LabelStore, opts: RunOptions = {}): Promise<void> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  let backoff = 1000
  while (!opts.stopped?.()) {
    try {
      for await (const frame of source(await store.getCursor(src))) {
        const r = await store.applyFrame(src, frame)
        metrics.inc('indexer_labels_total', { src_hash: 'all' }, r.stored)
        if (r.queued) metrics.inc('indexer_label_reviews_total', {}, r.queued)
        backoff = 1000
        if (opts.stopped?.()) return
      }
    } catch (err) {
      log.warn('label stream failed; reconnecting', { src, err })
    }
    if (opts.stopped?.()) return
    await sleep(backoff)
    backoff = Math.min(backoff * 2, opts.maxBackoffMs ?? 60_000)
  }
}

/** LABELER_DIDS: comma or space separated DIDs. Anything that is not a DID is ignored with a warning. */
export function labelerDidsFromEnv(env: { LABELER_DIDS?: string | undefined } = process.env): string[] {
  const out: string[] = []
  for (const s of (env.LABELER_DIDS ?? '').split(/[\s,]+/).filter(Boolean)) {
    if (/^did:(plc|web):[A-Za-z0-9._:%-]+$/.test(s)) out.push(s)
    else log.warn('LABELER_DIDS entry ignored: not a DID')
  }
  return [...new Set(out)]
}
