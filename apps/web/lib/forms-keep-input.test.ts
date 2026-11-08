import { describe, expect, it, vi } from 'vitest'
import { runAddDomain, type DomainDeps } from './domain-form'
import { runImport, type ImportDeps } from './import-form'
import { runLogin, type LoginDeps } from './login-form'
import { runAddMember, runCreateOrg, type AddMemberDeps, type CreateOrgDeps } from './orgs/forms'
import { runReport, type ReportDeps } from './report-form'

const form = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}
const DID = 'did:plc:abc123'

describe('login', () => {
  const deps = (over: Partial<LoginDeps> = {}): LoginDeps => ({
    blocked: async () => null,
    parse: (h) => ({ kind: 'handle', value: h }),
    failed: vi.fn(async () => {}),
    remember: async () => {},
    start: async () => ({ ok: true, url: 'https://pds.example/authorize' }),
    ...over,
  })
  it('keeps a badly formed handle and reports it on the field', async () => {
    const r = await runLogin(form({ handle: 'alice' }), '/account', deps())
    expect(r.values?.handle).toBe('alice')
    expect(r.errors?.handle).toBeTruthy()
  })
  it('keeps the handle on rate limit and on authorize failure', async () => {
    const a = await runLogin(form({ handle: 'a.example.com' }), '/account', deps({ blocked: async () => 'Too many tries.' }))
    expect(a.formError).toBe('Too many tries.')
    expect(a.values?.handle).toBe('a.example.com')
    const b = await runLogin(form({ handle: 'a.example.com' }), '/account', deps({ start: async () => ({ ok: false }) }))
    expect(b.formError).toMatch(/Could not start/)
    expect(b.values?.handle).toBe('a.example.com')
  })
  it('redirects on success', async () => {
    expect((await runLogin(form({ handle: ' @A.Example.com ' }), '/account', deps())).redirectTo).toBe('https://pds.example/authorize')
  })
})

describe('report', () => {
  const deps = (over: Partial<ReportDeps> = {}): ReportDeps => ({ reporterDid: DID, available: true, submit: vi.fn(async () => 'sent' as const), report: () => {}, ...over })
  const ok = { did: 'did:plc:target', source: 'profile', reason: 'spam', details: 'This account sends spam.', contact: 'me@example.com' }
  it('reports every invalid field at once and keeps the details text', async () => {
    const d = deps()
    const r = await runReport(form({ ...ok, reason: '', details: 'short', contact: 'nope' }), d)
    expect(Object.keys(r.errors ?? {}).sort()).toEqual(['contact', 'details', 'reason'])
    expect(r.values?.details).toBe('short')
    expect(d.submit).not.toHaveBeenCalled()
  })
  it('keeps input on rate limit, write error, and expired session', async () => {
    const limited = await runReport(form(ok), deps({ submit: async () => 'limited' }))
    expect(limited.formError).toMatch(/Too many/)
    expect(limited.values?.details).toBe(ok.details)
    const broke = await runReport(form(ok), deps({ submit: async () => { throw new Error('db') } }))
    expect(broke.values?.contact).toBe(ok.contact)
    const out = await runReport(form(ok), deps({ reporterDid: null }))
    expect(out.sessionExpired).toBe(true)
    expect(out.values?.details).toBe(ok.details)
  })
  it('clears the form on success', async () => {
    const r = await runReport(form(ok), deps())
    expect(r.done).toMatch(/Thanks/)
    expect(r.values).toBeUndefined()
  })
})

describe('avatar import', () => {
  const deps = (over: Partial<ImportDeps> = {}): ImportDeps => ({
    limited: async () => null,
    run: vi.fn(async () => ({ ok: true as const, note: null })),
    report: () => {},
    messageFor: () => 'Something went wrong. Try again.',
    ...over,
  })
  const typed = { alt: 'A red kite', rating: 'g', rLabel: 'sexual', isDefault: 'on' }
  it('reports bad alt text and a missing rating together and keeps the rest', async () => {
    const r = await runImport(DID, form({ alt: 'x'.repeat(301), rating: '', isDefault: 'on' }), deps())
    expect(Object.keys(r.errors ?? {}).sort()).toEqual(['alt', 'rating'])
    expect(r.values?.isDefault).toBe(true)
    expect(r.values?.alt.length).toBe(301)
  })
  it('keeps input on rate limit, plan limit, write error, and expired session', async () => {
    expect((await runImport(DID, form(typed), deps({ limited: async () => 'Slow down.' }))).values?.alt).toBe('A red kite')
    expect((await runImport(DID, form(typed), deps({ run: async () => ({ ok: false, error: 'Plan full.' }) }))).formError).toBe('Plan full.')
    expect((await runImport(DID, form(typed), deps({ run: async () => { throw new Error('x') } }))).values?.alt).toBe('A red kite')
    const out = await runImport(null, form(typed), deps())
    expect(out.sessionExpired).toBe(true)
    expect(out.values?.alt).toBe('A red kite')
  })
  it('returns done on success', async () => {
    expect((await runImport(DID, form(typed), deps({ run: async () => ({ ok: true, note: 'Synced.' }) }))).done).toBe('Image imported. Synced.')
  })
})

describe('domain', () => {
  const deps = (over: Partial<DomainDeps> = {}): DomainDeps => ({
    limited: async () => null,
    enabled: true,
    isPlus: async () => true,
    hasDomain: async () => false,
    validate: (h) => (h.includes('.') ? { ok: true, value: h } : { ok: false, error: 'Enter a subdomain such as me.example.com.' }),
    add: async () => ({ ok: true }),
    ...over,
  })
  it('puts a bad hostname on the field and keeps it', async () => {
    const r = await runAddDomain(DID, form({ hostname: 'nodots' }), deps())
    expect(r.errors?.hostname).toBeTruthy()
    expect(r.values?.hostname).toBe('nodots')
  })
  it('keeps the hostname on rate limit, plan, Cloudflare error, and expired session', async () => {
    const h = form({ hostname: 'me.example.com' })
    expect((await runAddDomain(DID, h, deps({ limited: async () => 'Slow down.' }))).values?.hostname).toBe('me.example.com')
    expect((await runAddDomain(DID, h, deps({ isPlus: async () => false }))).formError).toMatch(/Plus/)
    expect((await runAddDomain(DID, h, deps({ add: async () => ({ ok: false, error: 'Cloudflare says no.' }) }))).values?.hostname).toBe('me.example.com')
    expect((await runAddDomain(DID, h, deps({ add: async () => ({ ok: false, error: 'In use.', field: true }) }))).errors?.hostname).toBe('In use.')
    expect((await runAddDomain(null, h, deps())).sessionExpired).toBe(true)
  })
})

describe('organizations', () => {
  const create = (over: Partial<CreateOrgDeps> = {}): CreateOrgDeps => ({
    limited: async () => null,
    hasDb: true,
    validName: (n) => (n.trim() ? n.trim() : null),
    create: async () => ({ ok: true, orgId: 'org_1' }),
    ...over,
  })
  it('keeps the organization name on every failure', async () => {
    expect((await runCreateOrg(DID, form({ name: '   ' }), create())).errors?.name).toBeTruthy()
    expect((await runCreateOrg(DID, form({ name: 'Acme' }), create({ limited: async () => 'Slow down.' }))).values?.name).toBe('Acme')
    expect((await runCreateOrg(DID, form({ name: 'Acme' }), create({ create: async () => ({ ok: false, error: 'Up to 5.' }) }))).values?.name).toBe('Acme')
    expect((await runCreateOrg(null, form({ name: 'Acme' }), create())).sessionExpired).toBe(true)
    expect((await runCreateOrg(DID, form({ name: 'Acme' }), create())).orgId).toBe('org_1')
  })
  const add = (over: Partial<AddMemberDeps> = {}): AddMemberDeps => ({
    limited: async () => null,
    hasDb: true,
    roleOf: async () => 'owner',
    canManage: (r) => r === 'owner',
    add: vi.fn(async () => ({ ok: true as const })),
    ...over,
  })
  it('flags a bad DID and role together and keeps both', async () => {
    const r = await runAddMember(DID, form({ org: 'o', member: 'bob', role: 'admin' }), add())
    expect(Object.keys(r.errors ?? {}).sort()).toEqual(['member', 'role'])
    expect(r.values).toEqual({ member: 'bob', role: 'admin' })
  })
  it('keeps input on rate limit, permission, and write errors', async () => {
    const f = form({ org: 'o', member: 'did:plc:bob', role: 'owner' })
    for (const d of [add({ limited: async () => 'Slow down.' }), add({ canManage: () => false }), add({ add: async () => ({ ok: false, error: 'Full.' }) })]) {
      const r = await runAddMember(DID, f, d)
      expect(r.formError).toBeTruthy()
      expect(r.values).toEqual({ member: 'did:plc:bob', role: 'owner' })
    }
    expect((await runAddMember(DID, f, add({ add: async () => ({ ok: false, error: 'That account is already a member.' }) }))).errors?.member).toBeTruthy()
    expect((await runAddMember(DID, f, add())).done).toBe('Member added.')
  })
})
