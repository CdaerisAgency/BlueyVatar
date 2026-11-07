/**
 * Lexicon validation against the published Lexicon spec (https://atproto.com/specs/lexicon),
 * the Permissions spec (https://atproto.com/specs/permission), the NSID spec
 * (https://atproto.com/specs/nsid), and the record key spec (https://atproto.com/specs/record-key).
 *
 * Layer 1 is the reference implementation's document parser (`@atproto/lexicon`). Layer 2 adds
 * the rules the spec states in prose that the parser does not enforce: reference resolution,
 * union and ref targets, key types, blob accept patterns, and the permission-set rules.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Lexicons, parseLexiconDoc, type LexiconDoc } from '@atproto/lexicon'
import { isValidNsid, isValidRecordKey } from '@atproto/syntax'

export interface LoadedLexicon {
  /** Path relative to the lexicons directory, with forward slashes. */
  file: string
  /** Parsed JSON, before schema parsing. */
  raw: unknown
  /** True for files under vendor/: third-party schemas that this repo does not publish. */
  vendor: boolean
}

export interface Issue {
  file: string
  path: string
  message: string
}

export interface ValidationResult {
  issues: Issue[]
  /** Documents that parsed, keyed by NSID. */
  docs: Map<string, { doc: LexiconDoc; file: string; vendor: boolean }>
}

/** String formats from the Lexicon spec, section "String Formats". */
const STRING_FORMATS = new Set([
  'at-identifier',
  'at-uri',
  'cid',
  'datetime',
  'did',
  'handle',
  'nsid',
  'tid',
  'record-key',
  'uri',
  'language',
])

/** Permission resources that the Lexicon spec supports in a permission set. */
const SET_RESOURCES = new Set(['repo', 'rpc'])
const REPO_ACTIONS = new Set(['create', 'update', 'delete'])
const REPO_FIELDS = new Set(['type', 'resource', 'collection', 'action'])
const RPC_FIELDS = new Set(['type', 'resource', 'lxm', 'aud', 'inheritAud'])

export function loadLexiconFiles(dir: string): LoadedLexicon[] {
  const out: LoadedLexicon[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.json')) {
        const file = relative(dir, p).split(sep).join('/')
        out.push({ file, raw: JSON.parse(readFileSync(p, 'utf8')), vendor: file.startsWith('vendor/') })
      }
    }
  }
  walk(dir)
  return out
}

/** Authority part of an NSID (everything before the name), in NSID order, e.g. `com.blueyvatar`. */
export function nsidAuthority(nsid: string): string {
  return nsid.slice(0, nsid.lastIndexOf('.'))
}

/** Domain whose `_lexicon` TXT record resolves the NSID: the authority reversed, e.g. `blueyvatar.com`. */
export function authorityDomain(nsid: string): string {
  return nsidAuthority(nsid).split('.').reverse().join('.')
}

/** DNS name for an NSID's authority, e.g. `_lexicon.blueyvatar.com`. */
export function lexiconDnsName(nsid: string): string {
  return `_lexicon.${authorityDomain(nsid)}`
}

/** Spec: "Permission sets can address resources in the same NSID group, or children, recursively deep." */
export function isUnderAuthority(setNsid: string, resourceNsid: string): boolean {
  const setAuth = nsidAuthority(setNsid)
  const resAuth = nsidAuthority(resourceNsid)
  return resAuth === setAuth || resAuth.startsWith(`${setAuth}.`)
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

export function validateLexicons(files: LoadedLexicon[]): ValidationResult {
  const issues: Issue[] = []
  const docs: ValidationResult['docs'] = new Map()

  // Layer 1: reference parser.
  for (const f of files) {
    try {
      const doc = parseLexiconDoc(f.raw)
      if (docs.has(doc.id)) {
        issues.push({ file: f.file, path: 'id', message: `duplicate NSID ${doc.id} (also in ${docs.get(doc.id)?.file})` })
        continue
      }
      docs.set(doc.id, { doc, file: f.file, vendor: f.vendor })
    } catch (err) {
      issues.push({ file: f.file, path: '', message: `does not parse as a lexicon: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  // Layer 2: spec rules.
  const lex = new Lexicons()
  for (const { doc } of docs.values()) lex.add(doc)

  for (const [nsid, { doc, file, vendor }] of docs) {
    const add = (path: string, message: string) => issues.push({ file, path, message })

    // The file path mirrors the NSID (the layout goat and lex install use).
    const expected = `${nsid.split('.').join('/')}.json`
    if (file !== expected && file !== `vendor/${expected}`) add('id', `file path should be ${expected}`)

    if (Object.keys(doc.defs).length === 0) add('defs', 'a lexicon with zero definitions is invalid')

    const raw = files.find((f) => f.file === file)?.raw
    if (raw !== undefined) checkNoFloats(raw, '', add)

    const primaries = Object.entries(doc.defs).filter(([, d]) =>
      ['record', 'query', 'procedure', 'subscription', 'permission-set'].includes(d.type),
    )
    if (primaries.length > 1) add('defs', 'a file can have at most one primary definition')

    for (const [name, def] of Object.entries(doc.defs)) {
      if (name.includes('#')) add(`defs.${name}`, 'definition names must not include a # prefix')
      walk(def as unknown as Json, `defs.${name}`, { nsid, lex, add, topLevel: true })
      if (def.type === 'permission-set') checkPermissionSet(def as unknown as Json, nsid, `defs.${name}`, docs, add)
    }
  }
  return { issues, docs }
}

interface Ctx {
  nsid: string
  lex: Lexicons
  add: (path: string, message: string) => void
  topLevel: boolean
}

function checkNoFloats(v: unknown, path: string, add: Ctx['add']) {
  if (typeof v === 'number' && !Number.isInteger(v)) add(path, 'floats are not allowed in the atproto data model')
  else if (Array.isArray(v)) v.forEach((x, i) => checkNoFloats(x, `${path}[${i}]`, add))
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) checkNoFloats(x, path ? `${path}.${k}` : k, add)
}

function resolveRef(ref: string, ctx: Ctx): { uri: string; def: Json | undefined } {
  const full = ref.startsWith('#') ? `${ctx.nsid}${ref}` : ref
  try {
    return { uri: full, def: ctx.lex.getDef(full) as unknown as Json | undefined }
  } catch {
    return { uri: full, def: undefined }
  }
}

function walk(def: Json, path: string, ctx: Ctx): void {
  const { add } = ctx
  const type = def.type
  const minMax = (lo: unknown, hi: unknown, what: string) => {
    if (typeof lo === 'number' && typeof hi === 'number' && lo > hi) add(path, `${what}: minimum is greater than maximum`)
  }
  switch (type) {
    case 'boolean':
    case 'integer':
    case 'string': {
      if (def.const !== undefined && def.default !== undefined) add(path, 'const and default are mutually exclusive')
      if (type === 'integer') minMax(def.minimum, def.maximum, 'integer')
      if (type === 'string') {
        minMax(def.minLength, def.maxLength, 'length')
        minMax(def.minGraphemes, def.maxGraphemes, 'graphemes')
        if (def.format !== undefined && !STRING_FORMATS.has(String(def.format))) add(path, `unknown string format "${String(def.format)}"`)
        for (const key of ['knownValues', 'enum'] as const) {
          const vals = def[key]
          if (Array.isArray(vals) && new Set(vals).size !== vals.length) add(path, `${key} has duplicate values`)
        }
      }
      return
    }
    case 'array': {
      minMax(def.minLength, def.maxLength, 'array length')
      if (isObj(def.items)) walk(def.items, `${path}.items`, { ...ctx, topLevel: false })
      else add(path, 'array requires items')
      return
    }
    case 'object': {
      const props = isObj(def.properties) ? def.properties : {}
      for (const key of ['required', 'nullable'] as const) {
        const list = def[key]
        if (Array.isArray(list)) for (const name of list) if (!(String(name) in props)) add(path, `${key} lists "${String(name)}", which is not in properties`)
      }
      for (const [name, p] of Object.entries(props)) if (isObj(p)) walk(p, `${path}.properties.${name}`, { ...ctx, topLevel: false })
      return
    }
    case 'record': {
      const key = String(def.key)
      const literal = key.startsWith('literal:') ? key.slice('literal:'.length) : undefined
      const okKey = key === 'tid' || key === 'nsid' || key === 'any' || (literal !== undefined && isValidRecordKey(literal))
      if (!okKey) add(path, `record key type "${key}" must be tid, nsid, any, or literal:<record-key>`)
      if (isObj(def.record)) {
        if (def.record.type !== 'object') add(`${path}.record`, 'a record schema must be an object')
        walk(def.record, `${path}.record`, { ...ctx, topLevel: false })
      }
      return
    }
    case 'blob': {
      const accept = def.accept
      if (Array.isArray(accept)) {
        for (const a of accept) {
          // Spec: each may end in * as a glob; */* means any; partial globs and a bare * are unsupported.
          if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/([a-z0-9][a-z0-9!#$&^_.+-]*|\*)$/i.test(String(a)) && a !== '*/*') {
            add(path, `blob accept "${String(a)}" is not a MIME type or a type/* glob`)
          }
        }
      }
      return
    }
    case 'ref': {
      const { uri, def: target } = resolveRef(String(def.ref), ctx)
      if (!target) add(path, `ref "${uri}" does not resolve`)
      else if (target.type === 'token') add(path, 'a ref cannot point to a token')
      else if (target.type === 'ref' || target.type === 'union') add(path, `a ref cannot point to a ${String(target.type)}`)
      return
    }
    case 'union': {
      const refs = Array.isArray(def.refs) ? def.refs.map(String) : []
      if (new Set(refs).size !== refs.length) add(path, 'union has duplicate refs')
      if (def.closed === true && refs.length === 0) add(path, 'an empty closed union is invalid')
      for (const r of refs) {
        const { uri, def: target } = resolveRef(r, ctx)
        if (!target) add(path, `union ref "${uri}" does not resolve`)
        else if (target.type !== 'object' && target.type !== 'record') add(path, `union ref "${uri}" must be an object or record, not ${String(target.type)}`)
      }
      return
    }
    case 'token':
      return
    default:
      return
  }
}

function checkPermissionSet(def: Json, setNsid: string, path: string, docs: ValidationResult['docs'], add: (p: string, m: string) => void) {
  for (const key of ['title:lang', 'detail:lang'] as const) {
    const langs = def[key]
    if (isObj(langs)) {
      for (const [code, text] of Object.entries(langs)) {
        if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{1,8})*$/.test(code)) add(`${path}.${key}`, `"${code}" is not a well-formed language tag`)
        if (typeof text !== 'string') add(`${path}.${key}.${code}`, 'must be a string')
      }
    }
  }
  const perms = Array.isArray(def.permissions) ? def.permissions : []
  if (perms.length === 0) add(`${path}.permissions`, 'a permission set needs at least one permission')
  perms.forEach((p, i) => {
    const pp = `${path}.permissions[${i}]`
    if (!isObj(p)) return add(pp, 'must be an object')
    if (p.type !== 'permission') add(pp, 'type must be "permission"')
    const resource = String(p.resource)
    if (!SET_RESOURCES.has(resource)) {
      return add(pp, `resource "${resource}" is not supported in a permission set (blob, account, and identity must be requested directly)`)
    }
    const allowed = resource === 'repo' ? REPO_FIELDS : RPC_FIELDS
    for (const k of Object.keys(p)) if (!allowed.has(k)) add(pp, `unknown field "${k}" for a ${resource} permission`)
    const nsidList = (field: string, required: boolean): string[] => {
      const v = p[field]
      if (v === undefined) {
        if (required) add(pp, `${field} is required`)
        return []
      }
      if (!Array.isArray(v) || v.length === 0) {
        add(pp, `${field} must be a non-empty array`)
        return []
      }
      if (new Set(v).size !== v.length) add(pp, `${field} has duplicates`)
      return v.map(String)
    }
    if (resource === 'repo') {
      for (const c of nsidList('collection', true)) {
        if (c.includes('*')) add(pp, `collection "${c}": wildcards are not supported in a permission set`)
        else if (!isValidNsid(c)) add(pp, `collection "${c}" is not a valid NSID`)
        else {
          if (!isUnderAuthority(setNsid, c)) add(pp, `collection "${c}" is outside the namespace authority of ${setNsid}`)
          const target = docs.get(c)?.doc.defs.main
          if (!target) add(pp, `collection "${c}" has no lexicon in this repository`)
          else if (target.type !== 'record') add(pp, `collection "${c}" is not a record lexicon`)
        }
      }
      if (p.action !== undefined) {
        for (const a of nsidActions(p.action, add, pp)) if (!REPO_ACTIONS.has(a)) add(pp, `action "${a}" must be create, update, or delete`)
      }
    } else {
      for (const m of nsidList('lxm', true)) {
        if (m.includes('*')) add(pp, `lxm "${m}": wildcards are not supported in a permission set`)
        else if (!isValidNsid(m)) add(pp, `lxm "${m}" is not a valid NSID`)
        else if (!isUnderAuthority(setNsid, m)) add(pp, `lxm "${m}" is outside the namespace authority of ${setNsid}`)
      }
      const aud = p.aud
      if (p.inheritAud === true && aud !== undefined) add(pp, 'inheritAud and aud cannot both be set')
      if (p.inheritAud !== true && aud !== '*') add(pp, 'aud must be "*" unless inheritAud is true (fixed DID references are not allowed in a set)')
    }
  })
}

function nsidActions(v: unknown, add: (p: string, m: string) => void, path: string): string[] {
  if (!Array.isArray(v) || v.length === 0) {
    add(path, 'action must be a non-empty array')
    return []
  }
  if (new Set(v).size !== v.length) add(path, 'action has duplicates')
  return v.map(String)
}
