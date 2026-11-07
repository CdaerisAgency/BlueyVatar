import { Lexicons, jsonToLex } from '@atproto/lexicon'
import { describe, expect, it } from 'vitest'
import {
  dnsRecords,
  dryRunLines,
  pdsFromDidDoc,
  planRecords,
  publishRecords,
  verifyPublication,
  type PlannedRecord,
} from './publish.js'
import { authorityDomain, isUnderAuthority, lexiconDnsName, loadLexiconFiles, validateLexicons, type LoadedLexicon } from './validate.js'

const repoLexicons = new URL('../../../lexicons', import.meta.url).pathname
const files = loadLexiconFiles(repoLexicons)
const DID = 'did:plc:abcdefghijklmnopqrstuvwx'

const doc = (id: string, main: unknown, extra: Record<string, unknown> = {}): LoadedLexicon => ({
  file: `${id.split('.').join('/')}.json`,
  raw: { lexicon: 1, id, defs: { main, ...extra } },
  vendor: false,
})
const recordDef = (properties: Record<string, unknown>, required: string[] = [], key = 'tid') => ({
  type: 'record',
  key,
  record: { type: 'object', required, properties },
})
const messages = (fs: LoadedLexicon[]) => validateLexicons([...files, ...fs]).issues.map((i) => i.message)

describe('repository lexicons', () => {
  it('all validate with no issues', () => {
    expect(validateLexicons(files).issues).toEqual([])
  })

  it('finds the four schemas, the permission set, and the vendored files', () => {
    const r = validateLexicons(files)
    const mine = [...r.docs].filter(([, v]) => !v.vendor).map(([k]) => k)
    expect(mine.sort()).toEqual([
      'com.blueyvatar.attestation',
      'com.blueyvatar.authFull',
      'com.blueyvatar.claim',
      'com.blueyvatar.image',
      'com.blueyvatar.profile',
    ])
    expect([...r.docs].filter(([, v]) => v.vendor)).toHaveLength(3)
  })

  it('accepts records that use purpose, caption, and sort', () => {
    const lex = new Lexicons()
    for (const { doc: d } of validateLexicons(files).docs.values()) lex.add(d)
    const base = {
      $type: 'com.blueyvatar.image',
      image: { $type: 'blob', ref: { $link: 'bafkreibme22gw2h7y2h7tg2fhqotaqjucnbc24deqo72b6mkl2egezxhvy' }, mimeType: 'image/png', size: 1000 },
      createdAt: '2026-11-07T12:00:00.000Z',
    }
    const ok = (extra: Record<string, unknown>) => lex.validate('com.blueyvatar.image', jsonToLex({ ...base, ...extra }))
    expect(ok({}).success).toBe(true)
    expect(ok({ purpose: 'gallery', caption: 'Day one', sort: 3 }).success).toBe(true)
    expect(ok({ purpose: 'avatar', sort: -1 }).success).toBe(true)
    // Open vocabulary: knownValues are suggestions, so another purpose is valid data.
    expect(ok({ purpose: 'banner' }).success).toBe(true)
    expect(ok({ caption: '👍🏽'.repeat(140) }).success).toBe(true)
    expect(ok({ caption: 'x'.repeat(141) }).success).toBe(false)
    expect(ok({ purpose: 'p'.repeat(33) }).success).toBe(false)
    expect(ok({ sort: 'first' }).success).toBe(false)
    expect(ok({ sort: 1.5 }).success).toBe(false)
    expect(lex.validate('com.blueyvatar.image', jsonToLex({ ...base, createdAt: undefined })).success).toBe(false)
  })

  it('accepts a profile, claim, and attestation record', () => {
    const lex = new Lexicons()
    for (const { doc: d } of validateLexicons(files).docs.values()) lex.add(d)
    const at = '2026-11-07T12:00:00.000Z'
    const ref = { uri: `at://${DID}/com.blueyvatar.image/3jzfcijpj2z2a`, cid: 'bafyreidp2wpcbzl2qiob2uwoc7lhntojx3tjcr553mmahw2f5cumtm3wpm' }
    expect(lex.validate('com.blueyvatar.profile', { $type: 'com.blueyvatar.profile', defaultImage: ref, interests: ['a'], createdAt: at }).success).toBe(true)
    expect(lex.validate('com.blueyvatar.claim', { $type: 'com.blueyvatar.claim', platform: 'github', uri: 'https://github.com/a', createdAt: at }).success).toBe(true)
    expect(lex.validate('com.blueyvatar.attestation', { $type: 'com.blueyvatar.attestation', subject: ref, result: 'verified', createdAt: at }).success).toBe(true)
  })
})

describe('permission set com.blueyvatar.authFull', () => {
  const set = validateLexicons(files).docs.get('com.blueyvatar.authFull')?.doc.defs.main as unknown as {
    type: string
    title: string
    detail: string
    permissions: { type: string; resource: string; collection: string[]; action?: string[] }[]
  }

  it('grants every action on exactly the three user-repo collections', () => {
    expect(set.type).toBe('permission-set')
    expect(set.permissions).toHaveLength(1)
    const p = set.permissions[0]!
    expect(p).toEqual({ type: 'permission', resource: 'repo', collection: ['com.blueyvatar.image', 'com.blueyvatar.profile', 'com.blueyvatar.claim'] })
    // No action field means create, update, and delete are all allowed (Permissions spec).
    expect(p.action).toBeUndefined()
  })

  it('does not include attestation (service repo), blob, or account permissions', () => {
    expect(JSON.stringify(set.permissions)).not.toMatch(/attestation|blob|account|identity|rpc/)
  })

  it('has display text and a name under the set namespace', () => {
    expect(set.title.length).toBeGreaterThan(0)
    expect(set.detail.length).toBeGreaterThan(0)
  })

  it('namespace authority follows the spec examples', () => {
    expect(isUnderAuthority('app.example.feed.authOnlyPost', 'app.example.feed.post')).toBe(true)
    expect(isUnderAuthority('app.example.feed.authOnlyPost', 'app.example.actor.profile')).toBe(false)
    expect(isUnderAuthority('app.example.authFull', 'app.example.actor.profile')).toBe(true)
    expect(isUnderAuthority('app.example.authFull', 'app.exampleish.thing')).toBe(false)
  })
})

describe('validator rejects spec violations', () => {
  const setDoc = (permission: Record<string, unknown>) =>
    doc('com.blueyvatar.authTest', { type: 'permission-set', permissions: [{ type: 'permission', ...permission }] })

  it('flags permission-set problems', () => {
    expect(messages([setDoc({ resource: 'blob', accept: ['image/*'] })]).join()).toMatch(/not supported in a permission set/)
    expect(messages([setDoc({ resource: 'repo', collection: ['com.blueyvatar.*'] })]).join()).toMatch(/wildcards/)
    expect(messages([setDoc({ resource: 'repo', collection: [] })]).join()).toMatch(/non-empty array/)
    expect(messages([setDoc({ resource: 'repo' })]).join()).toMatch(/collection is required/)
    expect(messages([setDoc({ resource: 'repo', collection: ['app.bsky.actor.profile'] })]).join()).toMatch(/outside the namespace authority/)
    expect(messages([setDoc({ resource: 'repo', collection: ['com.blueyvatar.missing'] })]).join()).toMatch(/no lexicon in this repository/)
    expect(messages([setDoc({ resource: 'repo', collection: ['com.blueyvatar.image'], action: ['write'] })]).join()).toMatch(/must be create, update, or delete/)
    expect(messages([setDoc({ resource: 'repo', collection: ['com.blueyvatar.image'], extra: true })]).join()).toMatch(/unknown field "extra"/)
    expect(messages([setDoc({ resource: 'rpc', lxm: ['com.blueyvatar.getThing'] })]).join()).toMatch(/aud must be/)
    expect(messages([setDoc({ resource: 'rpc', lxm: ['com.blueyvatar.getThing'], aud: 'did:web:x.com#svc' })]).join()).toMatch(/aud must be/)
    expect(messages([setDoc({ resource: 'rpc', lxm: ['com.blueyvatar.getThing'], inheritAud: true, aud: '*' })]).join()).toMatch(/cannot both be set/)
    expect(messages([doc('com.blueyvatar.authEmpty', { type: 'permission-set', permissions: [] })]).join()).toMatch(/at least one permission/)
    expect(messages([doc('com.blueyvatar.authLang', { type: 'permission-set', 'title:lang': { 'not a tag': 'x' }, permissions: [{ type: 'permission', resource: 'repo', collection: ['com.blueyvatar.image'] }] })]).join()).toMatch(/language tag/)
  })

  it('accepts a valid rpc permission with inheritAud', () => {
    expect(messages([setDoc({ resource: 'rpc', lxm: ['com.blueyvatar.getThing'], inheritAud: true })])).toEqual([])
    expect(messages([setDoc({ resource: 'rpc', lxm: ['com.blueyvatar.getThing'], aud: '*' })])).toEqual([])
  })

  it('flags schema problems', () => {
    expect(messages([doc('com.blueyvatar.a', recordDef({ x: { type: 'ref', ref: 'com.blueyvatar.nope' } }))]).join()).toMatch(/does not resolve/)
    expect(messages([doc('com.blueyvatar.b', recordDef({ x: { type: 'string' } }, ['y']))]).join()).toMatch(/not in properties|does not parse/)
    expect(messages([doc('com.blueyvatar.c', recordDef({}, [], 'rkey'))]).join()).toMatch(/record key type/)
    expect(messages([doc('com.blueyvatar.d', recordDef({}, [], 'literal:a/b'))]).join()).toMatch(/record key type/)
    expect(messages([doc('com.blueyvatar.e', recordDef({ b: { type: 'blob', accept: ['image/pn*'] } }))]).join()).toMatch(/accept/)
    expect(messages([doc('com.blueyvatar.f', recordDef({ b: { type: 'blob', accept: ['*'] } }))]).join()).toMatch(/accept/)
    expect(messages([doc('com.blueyvatar.h', recordDef({ u: { type: 'union', refs: [], closed: true } }))]).join()).toMatch(/empty closed union/)
    expect(messages([doc('com.blueyvatar.i', recordDef({ s: { type: 'string', format: 'email' } }))]).join()).toMatch(/unknown string format|does not parse/)
    expect(messages([doc('com.blueyvatar.j', recordDef({ s: { type: 'string', const: 'a', default: 'a' } }))]).join()).toMatch(/mutually exclusive/)
    expect(messages([doc('com.blueyvatar.k', recordDef({ s: { type: 'string', minLength: 5, maxLength: 2 } }))]).join()).toMatch(/minimum is greater/)
    expect(messages([{ ...doc('com.blueyvatar.m', recordDef({})), file: 'wrong/place.json' }]).join()).toMatch(/file path should be/)
    expect(messages([doc('com.blueyvatar.image', recordDef({}))]).join()).toMatch(/duplicate NSID/)
    expect(messages([{ file: 'bad.json', raw: { lexicon: 2, id: 'x', defs: {} }, vendor: false }]).join()).toMatch(/does not parse/)
  })

  it('flags a union that points at a token', () => {
    const t = doc('com.blueyvatar.tokens', { type: 'token' }, {})
    const u = doc('com.blueyvatar.useToken', recordDef({ u: { type: 'union', refs: ['com.blueyvatar.tokens'] } }))
    expect(messages([t, u]).join()).toMatch(/must be an object or record/)
  })

  it('flags floats in a raw document', () => {
    const d = doc('com.blueyvatar.floaty', recordDef({ n: { type: 'integer', minimum: 0 } }))
    ;(d.raw as { defs: { main: { record: { properties: { n: { minimum: number } } } } } }).defs.main.record.properties.n.minimum = 0.5
    expect(messages([d]).join()).toMatch(/floats|does not parse/)
  })
})

describe('DNS and records', () => {
  const result = validateLexicons(files)
  const planned = planRecords(files, result)

  it('maps the namespace to _lexicon.blueyvatar.com', () => {
    expect(authorityDomain('com.blueyvatar.image')).toBe('blueyvatar.com')
    expect(lexiconDnsName('com.blueyvatar.image')).toBe('_lexicon.blueyvatar.com')
    // Spec example: app.toy.record resolves via _lexicon.toy.app.
    expect(lexiconDnsName('app.toy.record')).toBe('_lexicon.toy.app')
    expect(lexiconDnsName('edu.university.dept.lab.blogging.getBlogPost')).toBe('_lexicon.blogging.lab.dept.university.edu')
  })

  it('needs exactly one TXT record for this repo, with the did= prefix', () => {
    const recs = dnsRecords(planned.map((p) => p.nsid), DID)
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({ name: '_lexicon.blueyvatar.com', type: 'TXT', value: `did=${DID}` })
    expect(recs[0]!.nsids).toHaveLength(5)
  })

  it('gives each authority its own TXT record', () => {
    const recs = dnsRecords(['com.blueyvatar.image', 'com.blueyvatar.sub.thing', 'app.toy.record'], DID)
    expect(recs.map((r) => r.name)).toEqual(['_lexicon.blueyvatar.com', '_lexicon.sub.blueyvatar.com', '_lexicon.toy.app'].sort())
  })

  it('plans one record per own schema, keyed by NSID, without vendored files', () => {
    expect(planned.map((p) => p.rkey)).toEqual([
      'com.blueyvatar.attestation',
      'com.blueyvatar.authFull',
      'com.blueyvatar.claim',
      'com.blueyvatar.image',
      'com.blueyvatar.profile',
    ])
    for (const p of planned) {
      expect(p.record.$type).toBe('com.atproto.lexicon.schema')
      expect(p.record.lexicon).toBe(1)
      expect(p.record.id).toBe(p.rkey)
      expect(Object.keys(p.record.defs)).toContain('main')
    }
    const image = planned.find((p) => p.nsid === 'com.blueyvatar.image')!
    expect(JSON.stringify(image.record)).toContain('"purpose"')
  })

  it('dry run prints the record keys and the exact TXT line, using no network', () => {
    const lines = dryRunLines(planned, DID)
    expect(lines).toContain('dry run: nothing is written')
    expect(lines).toContain('  would write at://<did>/com.atproto.lexicon.schema/com.blueyvatar.authFull')
    expect(lines).toContain(`  _lexicon.blueyvatar.com  TXT  "did=${DID}"`)
    expect(dryRunLines(planned, undefined).join('\n')).toContain('did=<DID of the publishing account>')
  })
})

describe('publishRecords', () => {
  const planned: PlannedRecord[] = [
    { nsid: 'com.blueyvatar.a', rkey: 'com.blueyvatar.a', record: { $type: 'com.atproto.lexicon.schema', lexicon: 1, id: 'com.blueyvatar.a', defs: { main: { type: 'token' } } } },
    { nsid: 'com.blueyvatar.b', rkey: 'com.blueyvatar.b', record: { $type: 'com.atproto.lexicon.schema', lexicon: 1, id: 'com.blueyvatar.b', defs: { main: { type: 'token' } } } },
    { nsid: 'com.blueyvatar.c', rkey: 'com.blueyvatar.c', record: { $type: 'com.atproto.lexicon.schema', lexicon: 1, id: 'com.blueyvatar.c', defs: { main: { type: 'token' } } } },
  ]
  const didDoc = { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }] }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  function stub(existing: Record<string, unknown>) {
    const calls: { url: string; method: string; auth?: string; body?: unknown }[] = []
    const f = (async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input))
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url: url.toString(), method: url.pathname.split('.').pop()!, auth: (init?.headers as Record<string, string>)?.authorization, body })
      if (url.pathname.endsWith('createSession')) return json(200, { accessJwt: 'jwt-token', did: DID, didDoc })
      if (url.pathname.endsWith('getRecord')) {
        const rkey = url.searchParams.get('rkey')!
        return rkey in existing ? json(200, { value: existing[rkey] }) : json(400, { error: 'RecordNotFound', message: 'not found' })
      }
      if (url.pathname.endsWith('putRecord')) return json(200, { uri: 'x', cid: 'y' })
      return json(500, { error: 'Unexpected', message: 'unexpected' })
    }) as unknown as typeof fetch
    return { f, calls }
  }

  it('creates, updates, and skips unchanged records, writing to the PDS from the DID document', async () => {
    const { f, calls } = stub({
      'com.blueyvatar.b': { ...planned[1]!.record, defs: { main: { type: 'token', description: 'old' } } },
      'com.blueyvatar.c': planned[2]!.record,
    })
    const lines: string[] = []
    const out = await publishRecords({ identifier: 'me.example.com', appPassword: 'pw-secret-1234', service: 'https://login.example.com' }, planned, { fetch: f, log: (l) => lines.push(l) })
    expect(out.did).toBe(DID)
    expect(out.pds).toBe('https://pds.example.com')
    expect(out.outcomes).toEqual([
      { nsid: 'com.blueyvatar.a', outcome: 'created' },
      { nsid: 'com.blueyvatar.b', outcome: 'updated' },
      { nsid: 'com.blueyvatar.c', outcome: 'unchanged' },
    ])
    const puts = calls.filter((c) => c.method === 'putRecord')
    expect(puts.map((c) => (c.body as { rkey: string }).rkey)).toEqual(['com.blueyvatar.a', 'com.blueyvatar.b'])
    expect(puts[0]!.url.startsWith('https://pds.example.com/')).toBe(true)
    expect(puts[0]!.auth).toBe('Bearer jwt-token')
    expect(puts[0]!.body).toMatchObject({ repo: DID, collection: 'com.atproto.lexicon.schema', record: planned[0]!.record })
    expect(calls[0]!.url.startsWith('https://login.example.com/')).toBe(true)
    expect(lines.join('\n')).not.toMatch(/pw-secret-1234|jwt-token/)
  })

  it('refuses plain http and does not echo the password in errors', async () => {
    await expect(publishRecords({ identifier: 'a', appPassword: 'pw-secret-1234', service: 'http://example.com' }, planned, { fetch: stub({}).f })).rejects.toThrow(/https/)
    const f = (async () => json(401, { error: 'AuthenticationRequired', message: 'Invalid identifier or password' })) as unknown as typeof fetch
    const err = await publishRecords({ identifier: 'a', appPassword: 'pw-secret-1234', service: 'https://x.example.com' }, planned, { fetch: f }).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/401 AuthenticationRequired/)
    expect((err as Error).message).not.toContain('pw-secret-1234')
  })

  it('reads the PDS from a DID document per the DID spec', () => {
    expect(pdsFromDidDoc(didDoc)).toBe('https://pds.example.com')
    expect(pdsFromDidDoc({ service: [{ id: '#other', type: 'x', serviceEndpoint: 'https://no' }] })).toBeUndefined()
    expect(pdsFromDidDoc(undefined)).toBeUndefined()
  })
})

describe('verifyPublication', () => {
  const planned = planRecords(files, validateLexicons(files))
  const txt = (...values: string[]) => async () => values.map((v) => [v])

  it('passes when the TXT value names the DID', async () => {
    const r = await verifyPublication(planned, DID, { resolveTxt: txt(`did=${DID}`, 'v=spf1 -all') })
    expect(r.dns).toEqual([{ name: '_lexicon.blueyvatar.com', ok: true, detail: `did=${DID}` }])
  })

  it('joins TXT chunks and fails on a wrong, missing, or duplicate value', async () => {
    const chunked = await verifyPublication(planned, DID, { resolveTxt: async () => [['did=did:plc:abcdefgh', 'ijklmnopqrstuvwx']] })
    expect(chunked.dns[0]!.ok).toBe(true)
    expect((await verifyPublication(planned, DID, { resolveTxt: txt('did=did:plc:other') })).dns[0]!.ok).toBe(false)
    expect((await verifyPublication(planned, DID, { resolveTxt: txt('hello') })).dns[0]!.detail).toMatch(/no did=/)
    expect((await verifyPublication(planned, DID, { resolveTxt: txt(`did=${DID}`, 'did=did:plc:other') })).dns[0]!.ok).toBe(false)
    const dnsFail = await verifyPublication(planned, DID, { resolveTxt: async () => { throw new Error('ENOTFOUND') } })
    expect(dnsFail.dns[0]).toMatchObject({ ok: false, detail: 'ENOTFOUND' })
  })

  it('compares served records with local files when a PDS is given', async () => {
    const byKey = new Map(planned.map((p) => [p.rkey, p.record]))
    const f = (async (input: URL | string) => {
      const rkey = new URL(String(input)).searchParams.get('rkey')!
      if (rkey === 'com.blueyvatar.claim') return new Response(JSON.stringify({ value: { ...byKey.get(rkey), description: 'changed' } }), { status: 200 })
      if (rkey === 'com.blueyvatar.profile') return new Response(JSON.stringify({ error: 'RecordNotFound', message: 'nope' }), { status: 400 })
      return new Response(JSON.stringify({ value: byKey.get(rkey) }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await verifyPublication(planned, DID, { resolveTxt: txt(`did=${DID}`), fetch: f, pds: 'https://pds.example.com' })
    const status = Object.fromEntries(r.records.map((x) => [x.nsid, x.ok]))
    expect(status).toEqual({
      'com.blueyvatar.attestation': true,
      'com.blueyvatar.authFull': true,
      'com.blueyvatar.claim': false,
      'com.blueyvatar.image': true,
      'com.blueyvatar.profile': false,
    })
  })
})
