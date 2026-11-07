import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import robots from '../app/robots'
import { pageMetadata, pricingDescription, ROBOTS_ALLOW, ROBOTS_DISALLOW, siteUrl, STATIC_PAGES } from './site'
import { PRICING } from './pricing'
import { jsonLdString, personJsonLd, profileCanonical, sitemapIndexXml, urlsetXml } from './seo'
import { profileMetadata, type PublicProfile } from './profile-page'
import { profilesSitemap, rootSitemap, type SitemapSource } from './sitemap'
import { countEligibleProfiles, eligibleProfiles, filterByLabel, type SitemapProfile } from './sitemap-store'

const base = 'https://blueyvatar.com'

describe('siteUrl', () => {
  it('defaults to the canonical host and strips paths and trailing slashes', () => {
    expect(siteUrl(undefined)).toBe('https://blueyvatar.com')
    expect(siteUrl('')).toBe('https://blueyvatar.com')
    expect(siteUrl('https://staging.example.com/')).toBe('https://staging.example.com')
    expect(siteUrl('not a url')).toBe('https://blueyvatar.com')
    expect(siteUrl('javascript:alert(1)')).toBe('https://blueyvatar.com')
  })
})

describe('robots', () => {
  const r = robots()
  const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules
  it('allows public paths and disallows private ones', () => {
    expect(rule.userAgent).toBe('*')
    expect(rule.allow).toEqual(expect.arrayContaining(['/', '/p/', '/a/', '/policy', '/privacy', '/docs', '/pricing']))
    expect(rule.disallow).toEqual(['/account', '/oauth', '/login', '/logout', '/report', '/api'])
  })
  it('never allows a disallowed path and points at the sitemap', () => {
    for (const d of ROBOTS_DISALLOW) expect(ROBOTS_ALLOW.some((a) => a !== '/' && d.startsWith(a))).toBe(false)
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/)
  })
})

describe('canonical output', () => {
  it('uses the site URL for profiles and the custom domain when verified', () => {
    expect(profileCanonical('alice.test', null, base)).toBe('https://blueyvatar.com/p/alice.test')
    expect(profileCanonical('alice.test', undefined, 'https://x.test')).toBe('https://x.test/p/alice.test')
    expect(profileCanonical('alice.test', 'me.alice.dev', base)).toBe('https://me.alice.dev/')
  })
  it('puts the canonical URL on page and profile metadata', () => {
    expect(pageMetadata('/pricing', 'T', 'D', base).alternates.canonical).toBe('https://blueyvatar.com/pricing')
    const p: PublicProfile = { did: 'did:plc:a', handle: 'alice.test', displayName: 'Alice', description: 'Hi', avatar: null, jobTitle: null, company: null, location: null, pronouns: null }
    const m = profileMetadata(p, 'alice.test', 'https://img.test', 'https://me.alice.dev/', base)
    expect(m.alternates).toEqual({ canonical: 'https://me.alice.dev/' })
    expect(m.openGraph.url).toBe('https://me.alice.dev/')
    // No avatar: the default image.
    expect(m.openGraph.images).toEqual(['https://blueyvatar.com/logo.jpg'])
  })
})

describe('pricing metadata', () => {
  it('lists every tier from the pricing table', () => {
    const d = pricingDescription()
    expect(d).toContain('Free $0')
    expect(d).toContain('Plus $9.99/mo')
    expect(d).toContain('Pro $9/mo')
    expect(d).toContain('Business $49/mo')
    expect(PRICING).toHaveLength(4)
  })
})

describe('personJsonLd', () => {
  const p: PublicProfile = {
    did: 'did:plc:secret', handle: 'alice.test', displayName: 'Alice', description: 'Builder </script><b>', avatar: { url: '/img/a/b/c/256.png' },
    jobTitle: 'Dev', company: 'Acme', location: 'Oslo', pronouns: 'she/her', timezone: 'Europe/Oslo',
    links: [{ label: 'Site', url: 'https://alice.test/' }, { label: 'Bad', url: 'http://insecure.test/' }],
    verifiedAccounts: [{ platform: 'github', uri: 'https://github.com/alice', hidden: false }, { platform: 'mastodon', uri: 'https://m.test/@a', hidden: true }],
  }
  const ld = personJsonLd(p, 'https://blueyvatar.com/p/alice.test', 'https://img.test/')
  it('maps public fields', () => {
    expect(ld).toMatchObject({
      '@type': 'Person', name: 'Alice', alternateName: 'alice.test', url: 'https://blueyvatar.com/p/alice.test', jobTitle: 'Dev',
      worksFor: { name: 'Acme' }, homeLocation: { name: 'Oslo' }, image: 'https://img.test/img/a/b/c/256.png',
    })
    expect(ld.sameAs).toEqual(['https://alice.test/', 'https://github.com/alice'])
  })
  it('carries no DID, email data, time zone, or hidden accounts', () => {
    const s = JSON.stringify(ld)
    for (const bad of ['did:plc', 'secret', 'mail', 'hash', 'Europe/Oslo', 'm.test', 'insecure']) expect(s).not.toContain(bad)
  })
  it('cannot close the script tag', () => {
    expect(jsonLdString(ld)).not.toContain('</script>')
    expect(JSON.parse(jsonLdString(ld)).description).toBe('Builder </script><b>')
  })
})

describe('sitemap documents', () => {
  const profile = (i: number): SitemapProfile => ({ did: `did:plc:${i}`, handle: `u${i}.test`, updatedAt: new Date('2026-01-02T03:04:05Z') })
  const source = (rows: SitemapProfile[], hidden: string[] = []): SitemapSource => ({
    count: async () => rows.length,
    page: async (limit, offset) => rows.slice(offset, offset + limit),
    check: async (did) => !hidden.includes(did),
  })
  it('lists static pages and profiles, escaping XML', () => {
    expect(urlsetXml([{ url: 'https://a.test/?a=1&b=2' }])).toContain('<loc>https://a.test/?a=1&amp;b=2</loc>')
    expect(sitemapIndexXml(['https://a.test/s.xml'])).toContain('<sitemapindex')
  })
  it('lists static pages and eligible profiles', async () => {
    const xml = await rootSitemap(source([profile(1), profile(2)]), base)
    for (const p of STATIC_PAGES) expect(xml).toContain(`<loc>${base}${p}</loc>`)
    expect(xml).toContain('<loc>https://blueyvatar.com/p/u1.test</loc>')
    expect(xml).toContain('<lastmod>2026-01-02T03:04:05.000Z</lastmod>')
  })
  it('drops accounts that carry the no-unauthenticated label or cannot be checked', async () => {
    const xml = await rootSitemap(source([profile(1), profile(2)], ['did:plc:2']), base)
    expect(xml).toContain('u1.test')
    expect(xml).not.toContain('u2.test')
    expect(await filterByLabel([profile(1), profile(2), profile(3)], async (d) => d !== 'did:plc:2', 2)).toHaveLength(2)
  })
  it('switches to a sitemap index past the URL limit and pages the profiles', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => profile(i))
    const src = source(rows)
    const idx = await rootSitemap(src, base, 3)
    expect(idx).toContain('<sitemapindex')
    expect(idx).toContain('/sitemap/static.xml')
    expect(idx).toContain('/sitemap/profiles/0.xml')
    expect(idx).toContain('/sitemap/profiles/2.xml')
    expect(idx).not.toContain('/sitemap/profiles/3.xml')
    const last = await profilesSitemap(src, base, 2, 3)
    expect(last.match(/<url>/g)).toHaveLength(1)
    expect(last).toContain('u6.test')
  })
  it('stays one urlset exactly at the limit', async () => {
    const xml = await rootSitemap(source([profile(1)]), base, STATIC_PAGES.length + 1)
    expect(xml).toContain('<urlset')
  })
})

const url = process.env.TEST_DATABASE_URL
const schema = `t_seo_${process.pid}_${Date.now()}`
describe.skipIf(!url)('eligibleProfiles (Postgres)', () => {
  let pool: pg.Pool
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    await admin.end()
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    for (const f of ['0001_init.sql', '0005_custom_domains.sql']) await pool.query(readFileSync(new URL(`../../../db/migrations/${f}`, import.meta.url), 'utf8'))
    const add = async (did: string, handle: string | null, o: { active?: boolean; rules?: string; domain?: string; noProfile?: boolean } = {}) => {
      await pool.query('INSERT INTO repos (did, handle, active) VALUES ($1, $2, $3)', [did, handle, o.active ?? true])
      if (!o.noProfile) await pool.query(`INSERT INTO profiles (did, record) VALUES ($1, '{}')`, [did])
      if (o.rules) await pool.query(`INSERT INTO visibility_rules (did, ${o.rules}) VALUES ($1, ${o.rules === 'domain_allowlist' ? `'{a.test}'` : 'true'})`, [did])
      if (o.domain) await pool.query(`INSERT INTO custom_domains (did, hostname, cf_id, status) VALUES ($1, $2, 'cf', 'active')`, [did, `${handle}.example.com`])
    }
    await add('did:plc:ok', 'ok.test')
    await add('did:plc:hidden', 'hidden.test', { rules: 'hidden_profile' })
    await add('did:plc:keyed', 'keyed.test', { rules: 'keyed_only' })
    await add('did:plc:allow', 'allow.test', { rules: 'domain_allowlist' })
    await add('did:plc:down', 'down.test', { active: false })
    await add('did:plc:nohandle', null)
    await add('did:plc:noprofile', 'noprofile.test', { noProfile: true })
    await add('did:plc:custom', 'custom.test', { domain: 'x' })
    await pool.query(`INSERT INTO repos (did, handle) VALUES ('did:plc:optout', 'optout.test')`)
    await pool.query(`INSERT INTO profiles (did, record) VALUES ('did:plc:optout', '{}')`)
    await pool.query(`INSERT INTO visibility_rules (did, email_lookup_opt_out) VALUES ('did:plc:optout', true)`)
  })
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool?.end()
  })
  it('lists only public, active profiles with a handle', async () => {
    const rows = await eligibleProfiles(pool)
    // An email-lookup opt-out only affects hash lookups, so that profile stays listed.
    expect(rows.map((r) => r.handle)).toEqual(['ok.test', 'optout.test'])
    expect(await countEligibleProfiles(pool)).toBe(2)
  })
  it('pages in a stable order', async () => {
    expect((await eligibleProfiles(pool, 1, 1)).map((r) => r.handle)).toEqual(['optout.test'])
  })
})
