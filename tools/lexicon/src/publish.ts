/**
 * Publishing helpers (https://atproto.com/specs/lexicon, "Lexicon Publication and Resolution").
 *
 * A schema is published as a `com.atproto.lexicon.schema` record whose record key is the NSID.
 * The NSID authority (all segments but the last, reversed) resolves to a DID through a DNS TXT
 * record named `_lexicon.<authority domain>` with the value `did=<did>`.
 */
import { lexiconDnsName, type LoadedLexicon, type ValidationResult } from './validate.js'

export const SCHEMA_COLLECTION = 'com.atproto.lexicon.schema'

export interface SchemaRecord {
  $type: typeof SCHEMA_COLLECTION
  lexicon: 1
  id: string
  description?: string
  defs: Record<string, unknown>
}

export interface PlannedRecord {
  nsid: string
  rkey: string
  record: SchemaRecord
}

export interface DnsRecord {
  name: string
  type: 'TXT'
  /** Value to paste into the DNS provider, without surrounding quotes. */
  value: string
  /** NSIDs that this record resolves. */
  nsids: string[]
}

/**
 * Records to publish: every validated lexicon outside vendor/. Fields follow the spec's record
 * field list: $type, lexicon, id, defs, and the optional description.
 */
export function planRecords(files: LoadedLexicon[], result: ValidationResult): PlannedRecord[] {
  const out: PlannedRecord[] = []
  for (const [nsid, { doc, file, vendor }] of result.docs) {
    if (vendor) continue
    const raw = files.find((f) => f.file === file)?.raw as { description?: string; defs: Record<string, unknown> }
    const record: SchemaRecord = { $type: SCHEMA_COLLECTION, lexicon: 1, id: doc.id, defs: raw.defs }
    if (typeof raw.description === 'string') record.description = raw.description
    out.push({ nsid, rkey: nsid, record })
  }
  return out.sort((a, b) => a.nsid.localeCompare(b.nsid))
}

/** One TXT record per distinct authority. Resolvers do not recurse up or down the DNS hierarchy. */
export function dnsRecords(nsids: string[], did: string): DnsRecord[] {
  const byName = new Map<string, DnsRecord>()
  for (const nsid of nsids) {
    const name = lexiconDnsName(nsid)
    const entry = byName.get(name) ?? { name, type: 'TXT' as const, value: `did=${did}`, nsids: [] }
    entry.nsids.push(nsid)
    byName.set(name, entry)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function dnsLines(planned: PlannedRecord[], did: string): string[] {
  const lines = ['DNS TXT records to create (one per authority; resolvers do not search parent or child names):']
  for (const r of dnsRecords(planned.map((p) => p.nsid), did)) {
    lines.push(`  ${r.name}  TXT  "${r.value}"`, `    resolves: ${r.nsids.join(', ')}`)
  }
  return lines
}

export const PERMISSION_SET_NSID = 'com.blueyvatar.authFull'

/**
 * Checks the planned records before anything is written: each is a `com.atproto.lexicon.schema`
 * record (lexicon 1, id, non-empty defs), its record key equals its NSID, keys are unique, and the
 * permission set is among them with a permission-set main def.
 */
export function checkPlan(planned: PlannedRecord[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const p of planned) {
    const r = p.record as Partial<SchemaRecord>
    if (r.$type !== SCHEMA_COLLECTION) problems.push(`${p.nsid}: $type must be ${SCHEMA_COLLECTION}`)
    if (r.lexicon !== 1) problems.push(`${p.nsid}: lexicon must be 1`)
    if (r.id !== p.nsid) problems.push(`${p.nsid}: record id "${String(r.id)}" does not match the NSID`)
    if (p.rkey !== p.nsid) problems.push(`${p.nsid}: record key "${p.rkey}" must equal the NSID`)
    if (!r.defs || typeof r.defs !== 'object' || Object.keys(r.defs).length === 0) problems.push(`${p.nsid}: defs is empty`)
    if (seen.has(p.rkey)) problems.push(`${p.nsid}: duplicate record key`)
    seen.add(p.rkey)
  }
  const set = planned.find((p) => p.nsid === PERMISSION_SET_NSID)
  if (!set) problems.push(`${PERMISSION_SET_NSID} (the permission set) is not in the records to publish`)
  else if ((set.record.defs.main as { type?: string } | undefined)?.type !== 'permission-set') problems.push(`${PERMISSION_SET_NSID}: main def must be a permission-set`)
  return problems
}

export const DID_PLACEHOLDER = '<DID of the publishing account>'

/** Output of `publish --dry-run`: no network, no credentials. */
export function dryRunLines(planned: PlannedRecord[], did: string | undefined): string[] {
  return [
    'dry run: nothing is written',
    ...planned.map((p) => `  would write at://<did>/${SCHEMA_COLLECTION}/${p.rkey}`),
    '',
    'records (each is the exact putRecord body):',
    ...planned.map((p) => JSON.stringify({ repo: did || DID_PLACEHOLDER, collection: SCHEMA_COLLECTION, rkey: p.rkey, record: p.record })),
    '',
    `checks passed: ${planned.length} schema record(s), record keys equal NSIDs, ${PERMISSION_SET_NSID} included`,
    '',
    ...dnsLines(planned, did || DID_PLACEHOLDER),
  ]
}

/** Stable JSON with sorted keys, for comparing a local record with a fetched one. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

type Fetch = typeof fetch

function assertHttps(url: string, what: string) {
  const u = new URL(url)
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error(`${what} must be an https URL`)
}

async function xrpc<T>(f: Fetch, base: string, method: string, init: { token?: string; body?: unknown; query?: Record<string, string> }): Promise<T> {
  const url = new URL(`/xrpc/${method}`, base)
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v)
  const res = await f(url, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = undefined
  }
  if (!res.ok) {
    const e = (json ?? {}) as { error?: string; message?: string }
    // Only the server's error code and message are surfaced, never the request body.
    throw new XrpcError(res.status, e.error ?? 'Unknown', `${method} failed (${res.status} ${e.error ?? 'Unknown'}): ${e.message ?? 'no message'}`)
  }
  return json as T
}

export class XrpcError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

interface DidDoc {
  service?: { id?: string; type?: string; serviceEndpoint?: unknown }[]
}

/** First `#atproto_pds` / AtprotoPersonalDataServer entry, per https://atproto.com/specs/did. */
export function pdsFromDidDoc(doc: DidDoc | undefined): string | undefined {
  const s = doc?.service?.find((x) => x.id?.endsWith('#atproto_pds') && x.type === 'AtprotoPersonalDataServer')
  return typeof s?.serviceEndpoint === 'string' ? s.serviceEndpoint : undefined
}

export interface Credentials {
  identifier: string
  appPassword: string
  /** Server to log in against. The PDS from the DID document is used for the writes when present. */
  service: string
}

export type Outcome = 'created' | 'updated' | 'unchanged'

export async function publishRecords(
  creds: Credentials,
  planned: PlannedRecord[],
  opts: { fetch?: Fetch; log?: (line: string) => void } = {},
): Promise<{ did: string; pds: string; outcomes: { nsid: string; outcome: Outcome }[] }> {
  const f = opts.fetch ?? fetch
  const log = opts.log ?? (() => {})
  assertHttps(creds.service, 'service URL')
  const session = await xrpc<{ accessJwt: string; did: string; didDoc?: DidDoc }>(f, creds.service, 'com.atproto.server.createSession', {
    body: { identifier: creds.identifier, password: creds.appPassword },
  })
  const pds = pdsFromDidDoc(session.didDoc) ?? creds.service
  assertHttps(pds, 'PDS URL')
  log(`logged in as ${session.did} (PDS ${pds})`)

  const outcomes: { nsid: string; outcome: Outcome }[] = []
  for (const p of planned) {
    let existing: unknown
    try {
      existing = (await xrpc<{ value: unknown }>(f, pds, 'com.atproto.repo.getRecord', { query: { repo: session.did, collection: SCHEMA_COLLECTION, rkey: p.rkey } })).value
    } catch (err) {
      if (!(err instanceof XrpcError) || (err.code !== 'RecordNotFound' && err.status !== 404)) throw err
    }
    if (existing !== undefined && canonical(existing) === canonical(p.record)) {
      outcomes.push({ nsid: p.nsid, outcome: 'unchanged' })
      log(`unchanged ${p.nsid}`)
      continue
    }
    await xrpc(f, pds, 'com.atproto.repo.putRecord', {
      token: session.accessJwt,
      body: { repo: session.did, collection: SCHEMA_COLLECTION, rkey: p.rkey, record: p.record },
    })
    const outcome: Outcome = existing === undefined ? 'created' : 'updated'
    outcomes.push({ nsid: p.nsid, outcome })
    log(`${outcome} at://${session.did}/${SCHEMA_COLLECTION}/${p.rkey}`)
  }
  return { did: session.did, pds, outcomes }
}

export interface VerifyReport {
  dns: { name: string; ok: boolean; detail: string }[]
  records: { nsid: string; ok: boolean; detail: string }[]
}

/** Checks that each authority's TXT record names `did`, and optionally that the PDS serves matching records. */
export async function verifyPublication(
  planned: PlannedRecord[],
  did: string,
  deps: { resolveTxt: (name: string) => Promise<string[][]>; fetch?: Fetch; pds?: string },
): Promise<VerifyReport> {
  const report: VerifyReport = { dns: [], records: [] }
  for (const rec of dnsRecords(planned.map((p) => p.nsid), did)) {
    try {
      const values = (await deps.resolveTxt(rec.name)).map((chunks) => chunks.join(''))
      const dids = values.filter((v) => v.startsWith('did='))
      if (dids.length === 0) report.dns.push({ name: rec.name, ok: false, detail: 'no did= TXT value found' })
      else if (dids.length > 1) report.dns.push({ name: rec.name, ok: false, detail: `more than one did= value (${dids.join(', ')}); the spec does not define this case` })
      else report.dns.push({ name: rec.name, ok: dids[0] === rec.value, detail: dids[0] === rec.value ? rec.value : `found ${dids[0]}, expected ${rec.value}` })
    } catch (err) {
      report.dns.push({ name: rec.name, ok: false, detail: err instanceof Error ? err.message : String(err) })
    }
  }
  if (deps.pds) {
    const f = deps.fetch ?? fetch
    for (const p of planned) {
      try {
        const got = await xrpc<{ value: unknown }>(f, deps.pds, 'com.atproto.repo.getRecord', { query: { repo: did, collection: SCHEMA_COLLECTION, rkey: p.rkey } })
        const same = canonical(got.value) === canonical(p.record)
        report.records.push({ nsid: p.nsid, ok: same, detail: same ? 'matches local file' : 'differs from local file' })
      } catch (err) {
        report.records.push({ nsid: p.nsid, ok: false, detail: err instanceof Error ? err.message : String(err) })
      }
    }
  }
  return report
}
