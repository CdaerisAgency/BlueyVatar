import { parseArgs } from 'node:util'
import pg from 'pg'
import { purgerFromEnv } from './cloudflare.js'

export type Purge = (did: string, cids: string[]) => Promise<void>

/**
 * Writes the block row first, then purges the image's cached variants. Only /img is cached:
 * /avatar and /u answer with uncached redirects that skip blocked images (the resolver checks
 * isBlocked), so nothing else needs purging.
 */
export async function blockImage(pool: pg.Pool, purge: Purge, did: string, cid: string, reason: string, by: string): Promise<void> {
  await writeBlock(pool, did, cid, reason, by, 'block')
  await audit(pool, by, 'block_image', { did, cid, reason })
  await purge(did, [cid])
}

/** Every operator decision is also written to `admin_actions`, the same log the web admin page uses. */
async function audit(pool: pg.Pool, actor: string, action: string, t: { did: string; cid?: string; reportId?: number; reason?: string }): Promise<void> {
  await pool.query(
    'INSERT INTO admin_actions (actor, action, target_did, target_cid, report_id, reason) VALUES ($1, $2, $3, $4, $5, $6)',
    [actor, action, t.did, t.cid ?? null, t.reportId ?? null, t.reason ?? null],
  )
}

async function writeBlock(pool: pg.Pool, did: string, cid: string, reason: string, by: string, kind: 'block' | 'takedown'): Promise<void> {
  await pool.query(
    `INSERT INTO blocked_images (did, cid, reason, blocked_by, kind) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (did, cid) DO UPDATE
       SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by, blocked_at = now(), unblocked_at = NULL, kind = EXCLUDED.kind`,
    [did, cid, reason, by, kind],
  )
}

/**
 * Takedown for a reported account: blocks every indexed image of the DID (block and purge reuse
 * the same write as blockImage), then marks the report, or all open reports for that DID, actioned with who and why.
 * Records one `takedown` row in `admin_actions`. Returns the blocked CIDs.
 */
export async function blockDid(pool: pg.Pool, purge: Purge, did: string, reason: string, by: string, reportId?: number): Promise<string[]> {
  const { rows } = await pool.query<{ cid: string }>('SELECT DISTINCT cid FROM images WHERE did = $1', [did])
  for (const { cid } of rows) {
    await writeBlock(pool, did, cid, reason, by, 'takedown')
    await purge(did, [cid])
  }
  await pool.query(
    `UPDATE reports SET status = 'actioned', actioned_by = $2, action_reason = $3, actioned_at = now()
     WHERE target_did = $1 AND status = 'open' AND ($4::bigint IS NULL OR id = $4)`,
    [did, by, reason, reportId ?? null],
  )
  await audit(pool, by, 'takedown', { did, reportId, reason })
  return rows.map((r) => r.cid)
}

/** Lifts a block, then purges so any cached 404 for the image is dropped. Returns false when no active block existed. */
export async function unblockImage(pool: pg.Pool, purge: Purge, did: string, cid: string, by = 'operator'): Promise<boolean> {
  const { rowCount } = await pool.query(
    'UPDATE blocked_images SET unblocked_at = now() WHERE did = $1 AND cid = $2 AND unblocked_at IS NULL',
    [did, cid],
  )
  if (!rowCount) return false
  await audit(pool, by, 'unblock_image', { did, cid })
  await purge(did, [cid])
  return true
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  const { values, positionals } = parseArgs({
    args: rest.filter((a) => a !== '--'),
    allowPositionals: true,
    options: { reason: { type: 'string' }, by: { type: 'string' }, report: { type: 'string' } },
  })
  const [did, cid] = positionals
  const url = process.env.DATABASE_URL
  if (cmd === 'block-did') {
    if (!did || !url || !values.reason) {
      console.error('usage: DATABASE_URL=... pnpm ops:block-did -- <did> --reason "..." [--report id] [--by name]')
      return 2
    }
    const pool = new pg.Pool({ connectionString: url, max: 1 })
    try {
      const purge = purgerFromEnv({ ...process.env, CF_PURGE_MODE: 'prefix' })
      const cids = await blockDid(pool, purge, did, values.reason, values.by ?? process.env.USER ?? 'operator', values.report ? Number(values.report) : undefined)
      console.log(`blocked ${cids.length} image(s) for ${did}`)
      return 0
    } finally {
      await pool.end()
    }
  }
  if ((cmd !== 'block' && cmd !== 'unblock') || !did || !cid || !url || (cmd === 'block' && !values.reason)) {
    console.error('usage: DATABASE_URL=... pnpm ops:block -- <did> <cid> --reason "..." [--by name]\n       DATABASE_URL=... pnpm ops:unblock -- <did> <cid>')
    return 2
  }
  const by = values.by ?? process.env.USER ?? 'operator'
  // Prefix mode covers every size, format, and quality variant under /img/{did}/{cid}/, including
  // the signed paths proposed in PR #97.
  const purge = purgerFromEnv({ ...process.env, CF_PURGE_MODE: 'prefix' })
  const pool = new pg.Pool({ connectionString: url, max: 1 })
  try {
    if (cmd === 'block') {
      await blockImage(pool, purge, did, cid, values.reason!, by)
      console.log(`blocked ${did} ${cid}`)
    } else {
      console.log((await unblockImage(pool, purge, did, cid, by)) ? `unblocked ${did} ${cid}` : `no active block for ${did} ${cid}`)
    }
    return 0
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err); process.exit(1) })
}
