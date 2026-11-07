import { readdirSync, readFileSync } from 'node:fs'
import { Tap, type TapEvent, type TapHandler } from '@atproto/tap'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveProfileLinks } from '@blueyvatar/core'
import { managedMode, startManagedStack, type LiveStack } from '../test-support/tap-live-stack.js'
import { COLLECTIONS, type IndexWrites } from './handlers.js'
import { PgIndexWrites } from './pg-writes.js'
import { createIndexer } from './wiring.js'

/**
 * Live integration test for the indexer against a real Tap instance (issue #42). Opt-in: with no
 * flag and no variables below it skips, so default `pnpm -r test` and CI are unaffected.
 *
 * Two ways to run it (docs/testing-live-tap-v1.md):
 *
 *  1. Managed (LIVE_TAP_TEST=1 plus Docker, or TAP_LIVE_TAP_BIN). The test starts a local PLC
 *     directory and PDS (apps/indexer/live-stack) and the Tap image pinned in fly/tap.toml with the
 *     production signal collection and collection filters, then creates its own account. No real
 *     accounts and no network writes. Needs TEST_DATABASE_URL.
 *
 *  2. External. Point it at a running Tap and a test account you own:
 *       TAP_LIVE_URL, TAP_LIVE_IDENTIFIER, TAP_LIVE_APP_PASSWORD, TEST_DATABASE_URL
 *       optional: TAP_LIVE_ADMIN_PASSWORD, TAP_LIVE_PDS_URL (default https://bsky.social),
 *       TAP_LIVE_CHECK_STATUS=1 (also deactivate and reactivate the account)
 *
 * What it asserts, through the same `@atproto/tap` channel and `createIndexer` wiring the indexer
 * uses (src/wiring.ts) into `PgIndexWrites` on a throwaway schema: create, update and delete rows for
 * images, profiles, claims and profile links; that the Tap event `cid` is the record CID (issue #101);
 * that an event whose handler failed is not acked and comes back; and that account status events
 * update `repos`.
 *
 *   TAP_LIVE_TIMEOUT_MS     per-wait timeout (default 90000)
 */
const env = process.env
const mode = managedMode()
const managed = mode.kind === 'managed'
const dbUrl = env.TEST_DATABASE_URL
const waitMs = Number(env.TAP_LIVE_TIMEOUT_MS ?? 90_000)
const checkStatus = managed || env.TAP_LIVE_CHECK_STATUS === '1'

const externalMissing = [
  ['TAP_LIVE_URL', env.TAP_LIVE_URL],
  ['TAP_LIVE_IDENTIFIER', env.TAP_LIVE_IDENTIFIER],
  ['TAP_LIVE_APP_PASSWORD', env.TAP_LIVE_APP_PASSWORD],
  ['TEST_DATABASE_URL', dbUrl],
]
  .filter(([, v]) => !v)
  .map(([k]) => k)
const flagged = env.LIVE_TAP_TEST === '1'
// With the flag set, a missing prerequisite fails loudly in beforeAll instead of skipping, except
// when neither Docker nor a Tap binary is present, which the issue asks to skip.
const enabled = managed || (!flagged && externalMissing.length === 0)
if (!enabled) {
  console.info(
    mode.kind === 'skip' && flagged
      ? `[tap-live] skipped: ${mode.reason}.`
      : `[tap-live] skipped: set LIVE_TAP_TEST=1 (with Docker), or ${externalMissing.join(', ')}, to run the live Tap test (docs/testing-live-tap-v1.md).`,
  )
}

const schema = `t_taplive_${process.pid}_${Date.now()}`
const migrationsDir = new URL('../../../db/migrations/', import.meta.url)
const run = Date.now().toString(36)
// 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

interface Seen {
  evt: TapEvent
  /**
   * Handler outcome for this delivery: 'failed' (handler threw, so no ack), or 'ack-called' then
   * 'acked'. `SimpleIndexer` only calls ack after the handler resolved, so 'ack-called' means the
   * handler succeeded first.
   */
  marks: string[]
}

describe.skipIf(!enabled)('indexer against a live Tap', () => {
  let pool: pg.Pool
  let tap: Tap
  let stack: LiveStack | undefined
  let pdsUrl = ''
  let did = ''
  let jwt = ''
  let channelError: unknown
  let destroy: (() => Promise<void>) | undefined
  const seen: Seen[] = []
  const log: string[] = []
  const created: { collection: string; rkey: string }[] = []
  /** `did/rkey` keys whose next claim upsert throws, to prove a failed handler is not acked. */
  const failClaimOnce = new Set<string>()

  async function xrpc<T = Record<string, unknown>>(nsid: string, body: unknown, opts: { raw?: Buffer; type?: string } = {}): Promise<T> {
    // Procedures without input (activateAccount) reject any body, so send none when there is none.
    const payload = opts.raw ?? (body === undefined ? undefined : JSON.stringify(body))
    const res = await fetch(`${pdsUrl}/xrpc/${nsid}`, {
      method: 'POST',
      headers: { ...(payload === undefined ? {} : { 'content-type': opts.type ?? 'application/json' }), ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
      body: typeof payload === 'string' || payload === undefined ? payload : new Uint8Array(payload),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${nsid} failed: ${res.status} ${text}`)
    return (text ? JSON.parse(text) : {}) as T
  }

  async function putRecord(collection: string, rkey: string, record: Record<string, unknown>): Promise<string> {
    const out = await xrpc<{ cid: string }>('com.atproto.repo.putRecord', { repo: did, collection, rkey, record: { $type: collection, ...record }, validate: false })
    if (!created.some((c) => c.collection === collection && c.rkey === rkey)) created.push({ collection, rkey })
    return out.cid
  }

  async function deleteRecord(collection: string, rkey: string): Promise<void> {
    await xrpc('com.atproto.repo.deleteRecord', { repo: did, collection, rkey })
  }

  async function waitFor<T>(what: string, probe: () => Promise<T | undefined | false> | T | undefined | false): Promise<T> {
    const deadline = Date.now() + waitMs
    for (;;) {
      if (channelError) throw new Error(`Tap channel failed while waiting for ${what}: ${String(channelError)}`)
      const v = await probe()
      if (v) return v
      if (Date.now() > deadline) {
        const events = seen.filter((s) => (s.evt as { did: string }).did === did).map((s) => (s.evt.type === 'record' ? `${s.evt.action} ${s.evt.collection}/${s.evt.rkey}` : `identity ${s.evt.status}`))
        throw new Error(`timed out after ${waitMs} ms waiting for ${what}. Events seen for the test DID: ${JSON.stringify(events)}. Handler errors: ${JSON.stringify(log.slice(-5))}${stack ? `. Tap logs: ${stack.tapLogs().slice(-1500)}` : ''}`)
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  const q = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> => (await pool.query<T>(sql, params)).rows
  const recordEvents = (collection: string, rkey: string, action?: string) =>
    seen.filter((s) => s.evt.type === 'record' && s.evt.did === did && s.evt.collection === collection && s.evt.rkey === rkey && (!action || s.evt.action === action))

  beforeAll(async () => {
    if (!dbUrl) throw new Error('TEST_DATABASE_URL is required (the test creates and drops its own schema).')
    let tapUrl: string
    let adminPassword: string | undefined
    let identifier: string
    let appPassword: string
    if (managed) {
      stack = await startManagedStack((mode as { runtime: 'docker' | 'binary' }).runtime)
      console.info(`[tap-live] managed stack: Tap via ${stack.describe}, local PDS ${stack.pdsUrl}, local PLC ${stack.plcUrl}`)
      tapUrl = stack.tapUrl
      adminPassword = stack.tapAdminPassword
      pdsUrl = stack.pdsUrl
      identifier = stack.identifier
      appPassword = stack.appPassword
    } else {
      if (externalMissing.length) throw new Error(`missing ${externalMissing.join(', ')}`)
      tapUrl = env.TAP_LIVE_URL!
      adminPassword = env.TAP_LIVE_ADMIN_PASSWORD ?? env.TAP_ADMIN_PASSWORD
      pdsUrl = (env.TAP_LIVE_PDS_URL ?? 'https://bsky.social').replace(/\/+$/, '')
      identifier = env.TAP_LIVE_IDENTIFIER!
      appPassword = env.TAP_LIVE_APP_PASSWORD!
    }

    const admin = new pg.Client({ connectionString: dbUrl })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: dbUrl, options: `-c search_path=${schema}` })
    for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort()) {
      await pool.query(readFileSync(new URL(f, migrationsDir), 'utf8'))
    }

    const session = await xrpc<{ accessJwt: string; did: string }>('com.atproto.server.createSession', { identifier, password: appPassword })
    jwt = session.accessJwt
    did = session.did

    // The production wiring (src/wiring.ts) over the real Postgres writes. The proxy can make one
    // claim upsert throw so the test can watch an unacked event come back.
    const pgWrites = new PgIndexWrites(pool)
    const db = new Proxy(pgWrites, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target) as unknown
        if (typeof v !== 'function') return v
        if (prop === 'upsertClaim') {
          return async (d: string, rkey: string, record: Record<string, unknown>) => {
            if (failClaimOnce.delete(`${d}/${rkey}`)) throw new Error('injected handler failure')
            return (v as PgIndexWrites['upsertClaim']).call(target, d, rkey, record)
          }
        }
        return v.bind(target) as unknown
      },
    }) as IndexWrites
    const onError = (err: Error) => void log.push(`tap error: ${err.message}${err.cause ? ` (${String((err.cause as Error).message ?? err.cause)})` : ''}`)
    const indexer = createIndexer(db, onError)
    const handler: TapHandler = {
      onEvent: async (evt, opts) => {
        const entry: Seen = { evt, marks: [] }
        seen.push(entry)
        try {
          await indexer.onEvent(evt, {
            ...opts,
            ack: async () => {
              entry.marks.push('ack-called')
              await opts.ack()
              entry.marks.push('acked')
            },
          })
        } catch (e) {
          entry.marks.push('failed')
          throw e
        }
      },
      onError,
    }
    tap = new Tap(tapUrl, { adminPassword })
    const channel = tap.channel(handler)
    destroy = () => channel.destroy()
    channel.start().catch((err) => {
      channelError = err
    })
  }, 300_000)

  afterAll(async () => {
    // Best-effort cleanup of the test account's records, then the throwaway schema.
    for (const c of [...created].reverse()) {
      if (c.collection === COLLECTIONS.bskyProfile) continue
      await deleteRecord(c.collection, c.rkey).catch(() => undefined)
    }
    try {
      await destroy?.().catch(() => undefined)
      await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
      await pool?.end()
    } finally {
      await stack?.stop()
    }
  }, 60_000)

  it('indexes create, update and delete across all seven collections with correct CIDs', async () => {
    const now = new Date().toISOString()
    const imageRkey = `img${run}`
    const linkRkey = `lnk${run}`
    const claimRkey = `clm${run}`

    // The profile record is Tap's signal collection, so writing it makes Tap track the repo.
    // addRepos makes the start deterministic when Tap already knows the repo.
    const profileCid = await putRecord(COLLECTIONS.profile, 'self', { jobTitle: 'Tap live test', timezone: 'UTC', interests: ['tap'], createdAt: now })
    await tap.addRepos([did])

    const blob = (await xrpc<{ blob: Record<string, unknown> & { ref: { $link: string } } }>('com.atproto.repo.uploadBlob', undefined, { raw: PNG, type: 'image/png' })).blob
    const imageRecord = { image: blob, isDefault: true, license: 'cc-by', createdAt: now }
    const imageCid1 = await putRecord(COLLECTIONS.image, imageRkey, imageRecord)
    const linkCid1 = await putRecord(COLLECTIONS.bskyLink, linkRkey, { url: 'https://example.com/tap-live', title: 'First', createdAt: now })
    const claimCid1 = await putRecord(COLLECTIONS.claim, claimRkey, { platform: 'github', uri: 'https://github.com/tap-live-test', createdAt: now })
    const tangledCid = await putRecord(COLLECTIONS.tangledProfile, 'self', { description: 'Tap live test', links: [], stats: [], pinnedRepositories: [] })
    const tangledLegacyCid = await putRecord(COLLECTIONS.tangledLegacyProfile, 'self', { description: 'Tap live test', links: [], stats: [], pinnedRepositories: [] })
    const linkRef = { uri: `at://${did}/${COLLECTIONS.bskyLink}/${linkRkey}`, cid: linkCid1 }
    const bskyCid = await putRecord(COLLECTIONS.bskyProfile, 'self', { displayName: 'Tap live test', links: [linkRef] })

    // Creates: rows exist.
    await waitFor('image, profile, claim and link rows', async () => {
      const [i, p, c, l] = await Promise.all([
        q('SELECT 1 FROM images WHERE did = $1 AND rkey = $2', [did, imageRkey]),
        q('SELECT 1 FROM profiles WHERE did = $1', [did]),
        q('SELECT 1 FROM claims WHERE did = $1 AND rkey = $2', [did, claimRkey]),
        q('SELECT 1 FROM profile_links WHERE did = $1 AND rkey = $2', [did, linkRkey]),
      ])
      return i.length && p.length && c.length && l.length
    })
    const [image] = await q('SELECT cid, mime_type, is_default, license FROM images WHERE did = $1 AND rkey = $2', [did, imageRkey])
    expect(image).toEqual({ cid: blob.ref.$link, mime_type: 'image/png', is_default: true, license: 'cc-by' })
    const [claim] = await q('SELECT platform, uri FROM claims WHERE did = $1 AND rkey = $2', [did, claimRkey])
    expect(claim).toEqual({ platform: 'github', uri: 'https://github.com/tap-live-test' })
    expect((await q<{ record: { jobTitle: string } }>('SELECT record FROM profiles WHERE did = $1', [did]))[0]?.record.jobTitle).toBe('Tap live test')

    // The Tap event cid is the record CID (issue #101 and #42). Checked on the raw events for every
    // collection, which covers the Tangled profile records that the indexer does not store.
    await waitFor('create events for every collection', () =>
      [
        [COLLECTIONS.profile, 'self'],
        [COLLECTIONS.image, imageRkey],
        [COLLECTIONS.bskyLink, linkRkey],
        [COLLECTIONS.claim, claimRkey],
        [COLLECTIONS.tangledProfile, 'self'],
        [COLLECTIONS.tangledLegacyProfile, 'self'],
        [COLLECTIONS.bskyProfile, 'self'],
      ].every(([c, r]) => recordEvents(c!, r!).length > 0),
    )
    const cidOf = (collection: string, rkey: string) => {
      const last = recordEvents(collection, rkey).at(-1)?.evt
      return last?.type === 'record' ? last.cid : undefined
    }
    expect(cidOf(COLLECTIONS.profile, 'self'), 'com.blueyvatar.profile event cid').toBe(profileCid)
    expect(cidOf(COLLECTIONS.image, imageRkey), 'com.blueyvatar.image event cid').toBe(imageCid1)
    expect(cidOf(COLLECTIONS.claim, claimRkey), 'com.blueyvatar.claim event cid').toBe(claimCid1)
    expect(cidOf(COLLECTIONS.bskyLink, linkRkey), 'app.bsky.actor.link event cid').toBe(linkCid1)
    expect(cidOf(COLLECTIONS.tangledProfile, 'self'), 'org.tangled.actor.profile event cid').toBe(tangledCid)
    expect(cidOf(COLLECTIONS.tangledLegacyProfile, 'self'), 'sh.tangled.actor.profile event cid').toBe(tangledLegacyCid)
    expect(cidOf(COLLECTIONS.bskyProfile, 'self'), 'app.bsky.actor.profile event cid').toBe(bskyCid)

    // The stored link cid is the record CID, so the strongRef in the profile resolves and is not dropped.
    const [stored] = await q<{ rkey: string; cid: string; url: string; title: string | null }>('SELECT rkey, cid, url, title FROM profile_links WHERE did = $1 AND rkey = $2', [did, linkRkey])
    expect(stored?.cid).toBe(linkCid1)
    expect(resolveProfileLinks(did, [linkRef], [stored!])).toEqual([{ url: 'https://example.com/tap-live', label: 'First' }])

    // Updates: new cid and fields.
    const linkCid2 = await putRecord(COLLECTIONS.bskyLink, linkRkey, { url: 'https://example.com/tap-live', title: 'Second', createdAt: now })
    expect(linkCid2).not.toBe(linkCid1)
    await putRecord(COLLECTIONS.image, imageRkey, { ...imageRecord, isDefault: false })
    await putRecord(COLLECTIONS.claim, claimRkey, { platform: 'github', uri: 'https://github.com/tap-live-test-2', createdAt: now })
    await waitFor('updated rows', async () => {
      const [l] = await q<{ cid: string; title: string }>('SELECT cid, title FROM profile_links WHERE did = $1 AND rkey = $2', [did, linkRkey])
      const [i] = await q<{ is_default: boolean }>('SELECT is_default FROM images WHERE did = $1 AND rkey = $2', [did, imageRkey])
      const [c] = await q<{ uri: string }>('SELECT uri FROM claims WHERE did = $1 AND rkey = $2', [did, claimRkey])
      return l?.cid === linkCid2 && l.title === 'Second' && i?.is_default === false && c?.uri.endsWith('-2')
    })
    // The old strongRef no longer resolves, which is the behavior #101 relies on.
    const [updated] = await q<{ rkey: string; cid: string; url: string; title: string | null }>('SELECT rkey, cid, url, title FROM profile_links WHERE did = $1 AND rkey = $2', [did, linkRkey])
    expect(resolveProfileLinks(did, [linkRef], [updated!])).toEqual([])
    expect(resolveProfileLinks(did, [{ ...linkRef, cid: linkCid2 }], [updated!])).toEqual([{ url: 'https://example.com/tap-live', label: 'Second' }])

    // Deletes: rows disappear.
    await deleteRecord(COLLECTIONS.image, imageRkey)
    await deleteRecord(COLLECTIONS.bskyLink, linkRkey)
    await deleteRecord(COLLECTIONS.claim, claimRkey)
    await deleteRecord(COLLECTIONS.profile, 'self')
    await deleteRecord(COLLECTIONS.tangledProfile, 'self')
    await deleteRecord(COLLECTIONS.tangledLegacyProfile, 'self')
    await waitFor('deleted rows', async () => {
      const gone = await Promise.all([
        q('SELECT 1 FROM images WHERE did = $1 AND rkey = $2', [did, imageRkey]),
        q('SELECT 1 FROM profile_links WHERE did = $1 AND rkey = $2', [did, linkRkey]),
        q('SELECT 1 FROM claims WHERE did = $1 AND rkey = $2', [did, claimRkey]),
        q('SELECT 1 FROM profiles WHERE did = $1', [did]),
      ])
      return gone.every((r) => r.length === 0)
    })
    await waitFor('tangled delete events', () => recordEvents(COLLECTIONS.tangledProfile, 'self', 'delete').length > 0 && recordEvents(COLLECTIONS.tangledLegacyProfile, 'self', 'delete').length > 0)
  }, waitMs * 8)

  it('acknowledges an event only after its handler succeeded, and Tap redelivers one that failed', async () => {
    const rkey = `ack${run}`
    const claim = { platform: 'github', uri: 'https://github.com/tap-live-ack', createdAt: new Date().toISOString() }
    failClaimOnce.add(`${did}/${rkey}`)
    const cid = await putRecord(COLLECTIONS.claim, rkey, claim)

    // First delivery: the handler throws, so the channel must not ack and the row must not exist.
    const failed = await waitFor('the failed delivery', () => recordEvents(COLLECTIONS.claim, rkey).find((s) => s.marks.includes('failed')))
    expect(failed.marks).toEqual(['failed'])
    expect(await q('SELECT 1 FROM claims WHERE did = $1 AND rkey = $2', [did, rkey])).toHaveLength(0)

    // Tap never saw an ack, so after its retry timeout it sends the same event again. This time the
    // handler succeeds, the row appears, and only then is the ack sent.
    const retried = await waitFor('redelivery of the unacked event', () => recordEvents(COLLECTIONS.claim, rkey).find((s) => s !== failed && s.marks.includes('acked')))
    expect(retried.marks).toEqual(['ack-called', 'acked'])
    expect(retried.evt.type === 'record' && retried.evt.cid).toBe(cid)
    expect((await q<{ uri: string }>('SELECT uri FROM claims WHERE did = $1 AND rkey = $2', [did, rkey]))[0]?.uri).toBe(claim.uri)
    expect(log.some((l) => l.includes('injected handler failure'))).toBe(true)

    // Across the whole run, the only delivery without an ack is the injected failure.
    await deleteRecord(COLLECTIONS.claim, rkey)
    await waitFor('claim delete', async () => (await q('SELECT 1 FROM claims WHERE did = $1 AND rkey = $2', [did, rkey])).length === 0)
    await waitFor('all other deliveries acked', () => seen.every((s) => s === failed || s.marks.length === 2))
    for (const s of seen) if (s !== failed) expect(s.marks).toEqual(['ack-called', 'acked'])
    expect(seen.filter((s) => s.marks.includes('failed'))).toHaveLength(1)
  }, waitMs * 3)

  it.skipIf(!checkStatus)('updates repos when the account status changes', async () => {
    await xrpc('com.atproto.server.deactivateAccount', {})
    try {
      await waitFor('repos row inactive', async () => (await q<{ active: boolean; status: string }>('SELECT active, status FROM repos WHERE did = $1', [did]))[0]?.active === false)
      expect((await q<{ status: string }>('SELECT status FROM repos WHERE did = $1', [did]))[0]?.status).toBe('deactivated')
    } finally {
      await xrpc('com.atproto.server.activateAccount', undefined)
    }
    await waitFor('repos row active again', async () => (await q<{ active: boolean }>('SELECT active FROM repos WHERE did = $1', [did]))[0]?.active === true)
  }, waitMs * 4)
})
