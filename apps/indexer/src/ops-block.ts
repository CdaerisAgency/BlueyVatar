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
  await pool.query(
    `INSERT INTO blocked_images (did, cid, reason, blocked_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (did, cid) DO UPDATE
       SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by, blocked_at = now(), unblocked_at = NULL`,
    [did, cid, reason, by],
  )
  await purge(did, [cid])
}

/** Lifts a block, then purges so any cached 404 for the image is dropped. Returns false when no active block existed. */
export async function unblockImage(pool: pg.Pool, purge: Purge, did: string, cid: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'UPDATE blocked_images SET unblocked_at = now() WHERE did = $1 AND cid = $2 AND unblocked_at IS NULL',
    [did, cid],
  )
  if (!rowCount) return false
  await purge(did, [cid])
  return true
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  const { values, positionals } = parseArgs({
    args: rest.filter((a) => a !== '--'),
    allowPositionals: true,
    options: { reason: { type: 'string' }, by: { type: 'string' } },
  })
  const [did, cid] = positionals
  const url = process.env.DATABASE_URL
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
      console.log((await unblockImage(pool, purge, did, cid)) ? `unblocked ${did} ${cid}` : `no active block for ${did} ${cid}`)
    }
    return 0
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err); process.exit(1) })
}
