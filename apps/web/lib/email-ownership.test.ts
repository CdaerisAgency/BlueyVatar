import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emailHash, emailMd5 } from '@blueyvatar/core'
import { newPending } from './codes'
import { HOLD_MS, MAX_LINKED_EMAILS, decideLink } from './email-policy'
import type { EmailSender } from './email'
import { confirmLink, sendCode } from './link'
import { emailDomain } from './mask'
import { decryptJson, encryptJson } from './token-crypto'
import { memoryStore, pgStore, type Store } from './store'

const A = 'did:plc:alice'
const B = 'did:plc:bob'
const h = (n: number) => n.toString(16).padStart(64, '0')
const DAY = 24 * 60 * 60 * 1000

class Outbox implements EmailSender {
  sent: { to: string; subject: string; text: string }[] = []
  async send(m: { to: string; subject: string; text: string }) {
    this.sent.push(m)
  }
}

describe('emailDomain', () => {
  it('returns the lowercased part after the last @, and nothing else', () => {
    expect(emailDomain('Alice@Example.COM')).toBe('example.com')
    expect(emailDomain('  a@b.test  ')).toBe('b.test')
    expect(emailDomain('"a@b"@c.test')).toBe('c.test')
    expect(emailDomain('a@mail.example.org.')).toBe('mail.example.org')
  })
  it('returns null when there is no usable domain', () => {
    expect(emailDomain('nodomain')).toBeNull()
    expect(emailDomain('trailing@')).toBeNull()
    expect(emailDomain('a@b c.test')).toBeNull()
    expect(emailDomain(`a@${'x'.repeat(254)}.test`)).toBeNull()
  })
})

describe('decideLink (pure)', () => {
  it('re-verifying your own email is free even at the cap', () => {
    expect(decideLink({ owner: 'self', count: MAX_LINKED_EMAILS })).toEqual({ ok: true, moved: false })
  })
  it('moves a hash linked elsewhere, but still respects the cap', () => {
    expect(decideLink({ owner: 'other', count: 0 })).toEqual({ ok: true, moved: true })
    expect(decideLink({ owner: 'other', count: MAX_LINKED_EMAILS })).toEqual({ ok: false, reason: 'cap' })
  })
  it('refuses a hash held by another DID', () => {
    expect(decideLink({ owner: 'none', count: 0, heldByOtherUntil: 5 })).toEqual({ ok: false, reason: 'held', until: 5 })
  })
})

function suite(name: string, make: () => Promise<{ store: Store; age?: (ms: number) => Promise<void>; done?: () => Promise<void> }>) {
  describe(name, () => {
    let store: Store
    let age: (ms: number) => Promise<void>
    let done: (() => Promise<void>) | undefined
    beforeAll(async () => {
      const m = await make()
      store = m.store
      age = m.age ?? (async () => {})
      done = m.done
    })
    afterAll(async () => done?.())

    it('rule 1: one hash maps to one DID, and re-linking by the owner keeps a single row', async () => {
      expect(await store.links.link(h(1), A, 'code', emailMd5('a@x.test'))).toEqual({ ok: true, moved: false })
      expect(await store.links.link(h(1), A, 'code')).toEqual({ ok: true, moved: false })
      expect(await store.links.list(A)).toHaveLength(1)
      expect(await store.links.list(B)).toHaveLength(0)
    })

    it('rule 2: newest verification wins, old link removed, previous owner emailed', async () => {
      const outbox = new Outbox()
      const email = 'shared@x.test'
      await store.links.link(emailHash(email), A, 'code', emailMd5(email))
      // Bob asks for a code: it is mailed to the address and keeps the raw address for the move notice.
      const sent = await sendCode(B, email, store, outbox)
      expect(sent.kind).toBe('code_sent')
      expect(outbox.sent).toHaveLength(1)
      const pending = (await store.codes.get(B))!
      expect(decryptJson<string>(pending.emailEnc!)).toBe(email)
      // Alice still owns it until Bob passes the code.
      expect((await store.links.list(A)).map((l) => l.emailHash)).toContain(emailHash(email))
      const out = await confirmLink(B, pending, store, outbox)
      expect(out.kind).toBe('linked')
      expect((await store.links.list(A)).map((l) => l.emailHash)).not.toContain(emailHash(email))
      expect((await store.links.list(B)).map((l) => l.emailHash)).toContain(emailHash(email))
      expect(outbox.sent).toHaveLength(2)
      expect(outbox.sent[1]!.to).toBe(email)
      expect(outbox.sent[1]!.subject).toMatch(/different BlueyVatar account/)
      expect(outbox.sent[1]!.text).toMatch(/add this address again/)
      // The pending row (and the raw address) is gone.
      expect(await store.codes.get(B)).toBeUndefined()
    })

    it('domain: linking by code stores the email domain on the link row and never the address', async () => {
      const D1 = 'did:plc:domain1'
      const outbox = new Outbox()
      expect((await sendCode(D1, 'Person@Corp.Example.com', store, outbox)).kind).toBe('code_sent')
      const pending = (await store.codes.get(D1))!
      expect(pending.emailDomain).toBe('corp.example.com')
      expect((await confirmLink(D1, pending, store, outbox)).kind).toBe('linked')
      const row = (await store.links.list(D1))[0]!
      expect(row.emailDomain).toBe('corp.example.com')
      expect(JSON.stringify(row)).not.toMatch(/person|@/i)
    })

    it('domain: a direct link stores it, a re-verify without one keeps it, and a new one replaces it', async () => {
      const D2 = 'did:plc:domain2'
      await store.links.link(h(501), D2, 'trusted_pds', undefined, undefined, 'one.test')
      expect((await store.links.list(D2))[0]!.emailDomain).toBe('one.test')
      await store.links.link(h(501), D2, 'code')
      expect((await store.links.list(D2))[0]!.emailDomain).toBe('one.test')
      await store.links.link(h(501), D2, 'code', undefined, undefined, 'two.test')
      expect((await store.links.list(D2))[0]!.emailDomain).toBe('two.test')
    })

    it('domain: links made without one read as null, and a move takes the new owner\'s domain', async () => {
      const D3 = 'did:plc:domain3'
      const D4 = 'did:plc:domain4'
      await store.links.link(h(502), D3, 'code')
      expect((await store.links.list(D3))[0]!.emailDomain).toBeNull()
      await store.links.link(h(503), D3, 'code', undefined, undefined, 'old.test')
      await store.links.link(h(503), D4, 'code', undefined, undefined, 'new.test')
      expect((await store.links.list(D3)).find((l) => l.emailHash === h(503))).toBeUndefined()
      expect((await store.links.list(D4))[0]!.emailDomain).toBe('new.test')
      // Unlinking removes the row, and the domain with it.
      await store.links.remove(D4, h(503))
      expect(await store.links.list(D4)).toHaveLength(0)
    })

    it('rule 2: no move notice when the hash was not linked elsewhere', async () => {
      const outbox = new Outbox()
      await sendCode(B, 'fresh@x.test', store, outbox)
      const pending = (await store.codes.get(B))!
      expect(pending.emailEnc).toMatch(/^v1:/)
      await confirmLink(B, pending, store, outbox)
      expect(outbox.sent).toHaveLength(1)
    })

    it('rule 2: the previous owner can reclaim by the same flow', async () => {
      const outbox = new Outbox()
      const email = 'swap@x.test'
      await store.links.link(emailHash(email), A, 'code')
      await store.links.link(emailHash(email), B, 'code')
      await sendCode(A, email, store, outbox)
      await confirmLink(A, (await store.codes.get(A))!, store, outbox)
      expect((await store.links.list(A)).map((l) => l.emailHash)).toContain(emailHash(email))
      expect((await store.links.list(B)).map((l) => l.emailHash)).not.toContain(emailHash(email))
    })

    it('notices: the primary email is stored encrypted, follows the primary, and is removed with it', async () => {
      const N = 'did:plc:notices'
      const e1 = 'first@x.test'
      const e2 = 'second@x.test'
      const addr = async () => { const s = await store.links.noticeAddress(N); return s && decryptJson<string>(s) }
      expect(await addr()).toBeUndefined()
      await store.links.link(emailHash(e1), N, 'code', undefined, encryptJson(e1))
      const stored = (await store.links.noticeAddress(N))!
      expect(stored).toMatch(/^v1:/)
      expect(stored).not.toContain('first')
      expect(await addr()).toBe(e1)
      // A second, non-primary email is not stored.
      await store.links.link(emailHash(e2), N, 'code', undefined, encryptJson(e2))
      expect(await addr()).toBe(e1)
      // Moving the primary to an email whose address was not kept drops the stored one rather than keeping a stale one.
      await store.links.setPrimary(N, emailHash(e2))
      expect(await addr()).toBeUndefined()
      // Verifying it again stores it.
      await store.links.link(emailHash(e2), N, 'code', undefined, encryptJson(e2))
      expect(await addr()).toBe(e2)
      // Unlinking the primary removes the address; the promoted email has none stored.
      await store.links.remove(N, emailHash(e2))
      expect(await addr()).toBeUndefined()
      await store.links.link(emailHash(e1), N, 'code', undefined, encryptJson(e1))
      expect(await addr()).toBe(e1)
      // Another account taking the hash by newest-verification-wins removes it from the previous owner.
      await store.links.link(emailHash(e1), 'did:plc:taker', 'code', undefined, encryptJson(e1))
      expect(await addr()).toBeUndefined()
      expect(decryptJson<string>((await store.links.noticeAddress('did:plc:taker'))!)).toBe(e1)
      // Deleting the account removes it.
      await store.links.releaseAll('did:plc:taker')
      expect(await store.links.noticeAddress('did:plc:taker')).toBeUndefined()
    })

    it('rule 3: the 11th email is rejected, by the store and before a code is mailed', async () => {
      const C = 'did:plc:capped'
      for (let i = 100; i < 100 + MAX_LINKED_EMAILS; i++) expect((await store.links.link(h(i), C, 'code')).ok).toBe(true)
      expect(await store.links.link(h(999), C, 'code')).toEqual({ ok: false, reason: 'cap' })
      const outbox = new Outbox()
      const r = await sendCode(C, 'eleventh@x.test', store, outbox)
      expect(r).toEqual({ kind: 'error', message: expect.stringMatching(/at most 10/) })
      expect(outbox.sent).toHaveLength(0)
      // Moving a hash in from another account counts too.
      await store.links.link(h(998), 'did:plc:other', 'code')
      expect(await store.links.link(h(998), C, 'code')).toEqual({ ok: false, reason: 'cap' })
      expect((await store.links.list('did:plc:other')).map((l) => l.emailHash)).toEqual([h(998)])
      // Re-verifying one you have is still fine.
      expect((await store.links.link(h(100), C, 'code')).ok).toBe(true)
      // Unlinking frees a slot.
      await store.links.remove(C, h(101))
      expect((await store.links.link(h(999), C, 'code')).ok).toBe(true)
    })

    it('rule 4: first linked is primary, the user can change it, and it lists first', async () => {
      const D = 'did:plc:primary'
      await store.links.link(h(201), D, 'code')
      await store.links.link(h(202), D, 'code')
      await store.links.link(h(203), D, 'code')
      expect((await store.links.list(D)).map((l) => [l.emailHash, l.primary])).toEqual([[h(201), true], [h(202), false], [h(203), false]])
      expect(await store.links.setPrimary(D, h(203))).toBe(true)
      expect((await store.links.list(D)).map((l) => [l.emailHash, l.primary])).toEqual([[h(203), true], [h(201), false], [h(202), false]])
      expect(await store.links.setPrimary(D, h(1))).toBe(false)
      expect(await store.links.setPrimary(B, h(202))).toBe(false)
    })

    it('rule 4: unlinking or losing the primary promotes the oldest remaining email', async () => {
      const E = 'did:plc:promote'
      await store.links.link(h(301), E, 'code')
      await store.links.link(h(302), E, 'code')
      await store.links.link(h(303), E, 'code')
      await store.links.remove(E, h(301))
      expect((await store.links.list(E)).map((l) => [l.emailHash, l.primary])).toEqual([[h(302), true], [h(303), false]])
      // Another account takes the primary hash by newest-verification-wins.
      await store.links.link(h(302), 'did:plc:thief', 'code')
      expect((await store.links.list(E)).map((l) => [l.emailHash, l.primary])).toEqual([[h(303), true]])
      expect((await store.links.list('did:plc:thief'))[0]!.primary).toBe(true)
    })

    it('rule 5: an unlinked hash is held 30 days against other DIDs, reclaimable by the same DID', async () => {
      const F = 'did:plc:unlinker'
      const G = 'did:plc:latecomer'
      const email = 'held@x.test'
      await store.links.link(emailHash(email), F, 'code')
      expect(await store.links.remove(F, emailHash(email))).toBe(true)
      expect(await store.links.remove(F, emailHash(email))).toBe(false)
      const outbox = new Outbox()
      const blocked = await sendCode(G, email, store, outbox)
      expect(blocked).toEqual({ kind: 'error', message: expect.stringMatching(/released recently/) })
      expect(outbox.sent).toHaveLength(0)
      expect(await store.links.link(emailHash(email), G, 'code')).toMatchObject({ ok: false, reason: 'held' })
      // Same DID may reclaim during the hold, which also clears it.
      expect((await store.links.link(emailHash(email), F, 'code')).ok).toBe(true)
      await store.links.remove(F, emailHash(email))
      // After 30 days anyone may claim it.
      await age(HOLD_MS + DAY)
      expect((await store.links.link(emailHash(email), G, 'code')).ok).toBe(true)
    })

    it('rule 5: deleting an account holds every hash', async () => {
      const H = 'did:plc:deleted'
      await store.links.link(h(401), H, 'code')
      await store.links.link(h(402), H, 'code')
      await store.codes.put(newPending(H, h(403), 'm', '123456', Date.now()))
      expect(await store.links.releaseAll(H)).toBe(2)
      expect(await store.links.list(H)).toHaveLength(0)
      expect(await store.codes.get(H)).toBeUndefined()
      expect(await store.links.link(h(401), B, 'code')).toMatchObject({ ok: false, reason: 'held' })
      expect((await store.links.link(h(401), H, 'code')).ok).toBe(true)
      await age(HOLD_MS + DAY)
      expect((await store.links.link(h(402), B, 'code')).ok).toBe(true)
    })
  })
}

let now = Date.now()
suite('memory store', async () => {
  now = Date.now()
  return { store: memoryStore(() => now), age: async (ms) => void (now += ms) }
})

const url = process.env.TEST_DATABASE_URL
const m = (n: string) => readFileSync(new URL(`../../../db/migrations/${n}.sql`, import.meta.url), 'utf8')
const schema = `t_web_${process.pid}_${Date.now()}`
if (url) {
  suite('postgres store', async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const n of ['0001_init', '0002_web_auth', '0006_email_md5', '0010_email_ownership', '0013_notice_emails', '0016_email_domain', '0019_notification_prefs']) await pool.query(m(n))
    return {
      store: pgStore(pool),
      // Age every hold instead of waiting 30 days.
      age: async (ms) => void (await pool.query(`UPDATE email_holds SET released_at = released_at - ($1 * interval '1 millisecond')`, [ms])),
      done: async () => {
        await pool.query(`DROP SCHEMA ${schema} CASCADE`)
        await pool.end()
      },
    }
  })

  describe('postgres schema', () => {
    let pool: pg.Pool
    const s2 = `${schema}_b`
    beforeAll(async () => {
      const admin = new pg.Client({ connectionString: url })
      await admin.connect()
      await admin.query(`CREATE SCHEMA ${s2}`)
      await admin.end()
      pool = new pg.Pool({ connectionString: url, options: `-c search_path=${s2}` })
      await pool.query(m('0001_init'))
      await pool.query(m('0002_web_auth'))
      await pool.query(m('0006_email_md5'))
    })
    afterAll(async () => {
      await pool.query(`DROP SCHEMA ${s2} CASCADE`)
      await pool.end()
    })
    it('0016 adds email_domain to links and pending codes, is repeatable, and refuses an address', async () => {
      await pool.query(m('0010_email_ownership'))
      await pool.query(m('0013_notice_emails'))
      await pool.query(m('0016_email_domain'))
      await pool.query(m('0016_email_domain'))
      const cols = await pool.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'email_domain' ORDER BY table_name`, [s2])
      expect(cols.rows.map((r) => r.table_name)).toEqual(['email_codes', 'email_links'])
      await pool.query(`INSERT INTO email_links (email_hash, did, method, email_domain) VALUES ($1, 'did:plc:d16', 'code', 'example.com')`, [h(601)])
      await pool.query(`INSERT INTO email_links (email_hash, did, method) VALUES ($1, 'did:plc:d16', 'code')`, [h(602)])
      expect((await pool.query('SELECT email_domain FROM email_links WHERE email_hash = $1', [h(602)])).rows[0].email_domain).toBeNull()
      await expect(pool.query(`INSERT INTO email_links (email_hash, did, method, email_domain) VALUES ($1, 'did:plc:d16', 'code', 'a@example.com')`, [h(603)])).rejects.toThrow()
      await expect(pool.query(`INSERT INTO email_links (email_hash, did, method, email_domain) VALUES ($1, 'did:plc:d16', 'code', 'has space.com')`, [h(604)])).rejects.toThrow()
    })

    it('0007 backfills one primary per DID and enforces cap and single primary in the database', async () => {
      await pool.query(`INSERT INTO email_links (email_hash, did, method, verified_at) VALUES ($1, 'did:plc:old', 'code', now() - interval '2 days'), ($2, 'did:plc:old', 'code', now() - interval '1 day')`, [h(1), h(2)])
      await pool.query(m('0010_email_ownership'))
      await pool.query(m('0013_notice_emails'))
      expect((await pool.query(`SELECT email_hash FROM email_links WHERE is_primary AND did = 'did:plc:old'`)).rows).toEqual([{ email_hash: h(1) }])
      await expect(pool.query(`UPDATE email_links SET is_primary = true WHERE email_hash = $1`, [h(2)])).rejects.toThrow()
      for (let i = 10; i < 18; i++) await pool.query(`INSERT INTO email_links (email_hash, did, method) VALUES ($1, 'did:plc:old', 'code')`, [h(i)])
      await expect(pool.query(`INSERT INTO email_links (email_hash, did, method) VALUES ($1, 'did:plc:old', 'code')`, [h(99)])).rejects.toThrow(/email_link_cap/)
    })
    it('serializes concurrent claims so a hash ends with one owner and the cap holds', async () => {
      const store = pgStore(pool)
      const results = await Promise.all(['did:plc:r1', 'did:plc:r2', 'did:plc:r3', 'did:plc:r4'].map((d) => store.links.link(h(500), d, 'code')))
      expect(results.every((r) => r.ok)).toBe(true)
      expect((await pool.query('SELECT did FROM email_links WHERE email_hash = $1', [h(500)])).rowCount).toBe(1)
      const many = await Promise.all(Array.from({ length: 15 }, (_, i) => store.links.link(h(600 + i), 'did:plc:race', 'code')))
      expect(many.filter((r) => r.ok)).toHaveLength(MAX_LINKED_EMAILS)
      expect((await store.links.list('did:plc:race')).filter((l) => l.primary)).toHaveLength(1)
    })
  })
}

describe.skipIf(!url)('postgres: no plaintext address at rest', () => {
  const s3 = `${schema}_c`
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${s3}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${s3}` })
    for (const n of ['0001_init', '0002_web_auth', '0006_email_md5', '0010_email_ownership', '0013_notice_emails', '0016_email_domain', '0019_notification_prefs']) await pool.query(m(n))
  })
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${s3} CASCADE`)
    await pool.end()
  })

  it('keeps the address out of every table while a code is pending and after it is confirmed, including a move', async () => {
    const store = pgStore(pool)
    const outbox = new Outbox()
    const addr = 'Needle.Person@plaintext-check.test'
    const dump = async () => {
      const tables = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [s3])).rows
      let all = ''
      for (const t of tables) all += JSON.stringify((await pool.query(`SELECT * FROM "${t.table_name}"`)).rows)
      return all.toLowerCase()
    }
    await sendCode(A, addr, store, outbox)
    expect(await dump()).not.toContain('needle')
    // Only the domain is kept in the clear, on the pending code and then on the link row, never the full address.
    expect(await dump()).not.toContain('@plaintext-check')
    expect((await pool.query('SELECT email_domain FROM email_codes WHERE did = $1', [A])).rows[0].email_domain).toBe('plaintext-check.test')
    await confirmLink(A, (await store.codes.get(A))!, store, outbox)
    expect(await dump()).not.toContain('needle')
    expect(await dump()).not.toContain('@plaintext-check')
    expect((await pool.query('SELECT email_domain FROM email_links WHERE did = $1', [A])).rows[0].email_domain).toBe('plaintext-check.test')
    expect(decryptJson<string>((await store.links.noticeAddress(A))!)).toBe(addr)
    expect((await pool.query('SELECT email_enc FROM notice_emails WHERE did = $1', [A])).rows[0].email_enc).toMatch(/^v1:/)
    // Moving it to another account mails the previous owner at the same address and leaves nothing readable behind.
    await sendCode(B, addr, store, outbox)
    await confirmLink(B, (await store.codes.get(B))!, store, outbox)
    expect(outbox.sent.at(-1)!.to).toBe(addr)
    expect(await store.links.noticeAddress(A)).toBeUndefined()
    expect(await dump()).not.toContain('needle')
    // Deleting the account removes the stored address.
    await store.links.releaseAll(B)
    expect((await pool.query('SELECT 1 FROM notice_emails')).rowCount).toBe(0)
  })
})
