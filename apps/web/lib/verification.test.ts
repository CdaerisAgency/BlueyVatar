import { describe, expect, it } from 'vitest'
import { AtprotoAttestationWriter, LocalAttestationWriter, attestationWriterFromEnv } from './attestation'
import { memoryClaimStore } from './claim-store'
import { claimLabel, normalizeClaim, parseMastodonUri, profileLinkFor } from './claims'
import { githubAuthorizeUrl, githubClaimMatches, githubLogin } from './github-oauth'
import { accountUrl, authorizeUrl, mastodonClaimMatches, registerApp, type MastodonApp } from './mastodon-oauth'
import { extractRelMe, hasRelMeLink, sameUrl } from './relme'
import { guardedLookup, SafeFetchError, type Fetcher } from './safe-fetch'
import { isPrivateIp, isPublicHostname, parseSafeHttpsUrl } from './safe-url'
import { coolingDown } from './verification-service'
import { verifyRelMe } from './verify'

const norm = (p: string, i: string) => {
  const r = normalizeClaim(p, i)
  return r.ok ? r.value.uri : `error:${r.error}`
}

describe('claim normalization', () => {
  it('canonicalizes GitHub names and URLs', () => {
    expect(norm('github', 'Octocat')).toBe('https://github.com/Octocat')
    expect(norm('github', '@octocat')).toBe('https://github.com/octocat')
    expect(norm('github', 'https://www.github.com/octocat/repo')).toBe('https://github.com/octocat')
    expect(norm('github', 'github.com/octocat')).toBe('https://github.com/octocat')
    expect(norm('github', '-bad')).toMatch(/^error:/)
    expect(norm('github', 'https://evil.example/octocat')).toMatch(/^error:/)
  })
  it('canonicalizes Mastodon addresses', () => {
    expect(norm('mastodon', '@Alice@Mastodon.Social')).toBe('https://mastodon.social/@alice')
    expect(norm('mastodon', 'alice@mastodon.social')).toBe('https://mastodon.social/@alice')
    expect(norm('mastodon', 'https://mastodon.social/@alice')).toBe('https://mastodon.social/@alice')
    expect(norm('mastodon', '@alice@localhost')).toMatch(/^error:/)
    expect(norm('mastodon', '@alice@10.0.0.1')).toMatch(/^error:/)
    expect(parseMastodonUri('https://mastodon.social/@alice')).toEqual({ instance: 'mastodon.social', user: 'alice' })
    expect(parseMastodonUri('https://mastodon.social/about')).toBeNull()
  })
  it('canonicalizes Instagram and X, accepting twitter.com', () => {
    expect(norm('instagram', '@Some.User')).toBe('https://www.instagram.com/some.user')
    expect(norm('instagram', 'https://instagram.com/some.user/')).toBe('https://www.instagram.com/some.user')
    expect(norm('x', 'https://twitter.com/Jack')).toBe('https://x.com/jack')
    expect(norm('x', 'waytoolongusernamehere')).toMatch(/^error:/)
  })
  it('accepts only public https websites and drops the fragment', () => {
    expect(norm('website', 'example.com/me#top')).toBe('https://example.com/me')
    expect(norm('website', 'http://example.com')).toMatch(/^error:/)
    expect(norm('website', 'https://127.0.0.1/')).toMatch(/^error:/)
    expect(norm('website', 'https://user:pw@example.com/')).toMatch(/^error:/)
    expect(norm('website', 'https://example.com:8443/')).toMatch(/^error:/)
    expect(norm('website', 'javascript:alert(1)')).toMatch(/^error:/)
  })
  it('says coming later for TikTok and Threads and rejects unknown platforms', () => {
    expect(norm('tiktok', 'x')).toBe('error:TikTok verification is coming later.')
    expect(norm('threads', 'x')).toBe('error:Threads verification is coming later.')
    expect(norm('myspace', 'x')).toMatch(/^error:/)
  })
  it('builds profile links and labels', () => {
    expect(profileLinkFor('https://blueyvatar.com/', 'a.example.com')).toBe('https://blueyvatar.com/p/a.example.com')
    expect(claimLabel('mastodon', 'https://mastodon.social/@alice')).toBe('alice@mastodon.social')
  })
})

describe('URL safety', () => {
  it('flags private, loopback, and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:c0a8:101::1', 'ff02::1', '2001:db8::1', 'not-an-ip']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateIp(ip), ip).toBe(false)
  })
  it('accepts only plausible public hostnames', () => {
    expect(isPublicHostname('example.com')).toBe(true)
    expect(isPublicHostname('Mastodon.Social.')).toBe(true)
    for (const h of ['localhost', 'a.localhost', 'printer.local', 'db.internal', 'intranet', '127.0.0.1', '[::1]', '1.2.3.4', 'a_b.example.com', '', 'exa mple.com']) {
      expect(isPublicHostname(h), h).toBe(false)
    }
  })
  it('requires https without credentials or ports', () => {
    expect(parseSafeHttpsUrl('https://example.com/a')?.hostname).toBe('example.com')
    for (const u of ['http://example.com', 'https://a@example.com', 'https://example.com:444', 'https://localhost', 'ftp://example.com', 'nonsense']) {
      expect(parseSafeHttpsUrl(u), u).toBeNull()
    }
  })
  it('rejects a hostname that resolves to a private address and passes public ones', async () => {
    const run = (addrs: { address: string; family: number }[], all = false) =>
      new Promise<{ err: Error | null; addr?: unknown }>((resolve) =>
        guardedLookup((_h, cb) => cb(null, addrs))('x.example.com', { all }, (err, addr) => resolve({ err, addr })),
      )
    expect((await run([{ address: '10.0.0.5', family: 4 }])).err).toBeInstanceOf(SafeFetchError)
    expect((await run([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])).err).toBeInstanceOf(SafeFetchError)
    expect((await run([])).err).toBeInstanceOf(SafeFetchError)
    expect(await run([{ address: '8.8.8.8', family: 4 }])).toEqual({ err: null, addr: '8.8.8.8' })
    expect((await run([{ address: '8.8.8.8', family: 4 }], true)).addr).toEqual([{ address: '8.8.8.8', family: 4 }])
  })
})

const ME = 'https://blueyvatar.com/p/alice.example.com'
describe('rel="me" parsing', () => {
  it('finds a and link elements with a me token', () => {
    const html = `<head><link rel="me" href="${ME}"></head><body><a href='/x' rel="nofollow me noopener">x</a><a rel=me href=https://other.example/>o</a></body>`
    expect(extractRelMe(html, 'https://site.example/')).toEqual([ME, 'https://site.example/x', 'https://other.example/'])
  })
  it('ignores links without rel=me, comments, and scripts', () => {
    const html = `<a href="${ME}">plain</a><a rel="nofollow" href="${ME}">nf</a><a rel="menu" href="${ME}">m</a><!-- <a rel="me" href="${ME}"> --><script>"<a rel='me' href='${ME}'>"</script>`
    expect(hasRelMeLink(html, 'https://site.example/', ME)).toBe(false)
  })
  it('matches case, trailing slash, and fragments, but not other paths, hosts, or schemes', () => {
    expect(hasRelMeLink(`<A HREF="${ME}/#me" REL="ME">`, 'https://s.example/', ME)).toBe(true)
    expect(hasRelMeLink(`<a rel="me" href="https://BlueyVatar.com/p/Alice.Example.com/">`, 'https://s.example/', ME)).toBe(true)
    expect(sameUrl(ME, 'https://blueyvatar.com/p/bob.example.com')).toBe(false)
    expect(sameUrl(ME, 'https://evil.example/p/alice.example.com')).toBe(false)
    expect(sameUrl(ME, 'http://blueyvatar.com/p/alice.example.com')).toBe(false)
    expect(sameUrl(ME, `${ME}?x=1`)).toBe(false)
  })
  it('decodes entities and resolves relative hrefs', () => {
    expect(extractRelMe('<a rel="me" href="/p?a=1&amp;b=2">', 'https://s.example/dir/')).toEqual(['https://s.example/p?a=1&b=2'])
  })
})

describe('rel="me" verification', () => {
  const page = (html: string, type = 'text/html', status = 200): Fetcher => async (url) => ({ status, url, text: html, headers: { 'content-type': type } })
  it('verifies when the page links back', async () => {
    expect(await verifyRelMe('https://site.example/', ME, page(`<a rel="me" href="${ME}">me</a>`))).toEqual({ ok: true })
  })
  it('fails with a reason when the link is missing, the status is bad, or the type is wrong', async () => {
    expect(await verifyRelMe('https://site.example/', ME, page('<p>none</p>'))).toMatchObject({ ok: false })
    expect(await verifyRelMe('https://site.example/', ME, page('', 'text/html', 404))).toMatchObject({ ok: false, reason: expect.stringContaining('404') })
    expect(await verifyRelMe('https://site.example/', ME, page(`<a rel="me" href="${ME}">`, 'application/pdf'))).toMatchObject({ ok: false, reason: 'The page is not HTML.' })
  })
  it('reports guard errors from the fetcher', async () => {
    const blocked: Fetcher = async () => {
      throw new SafeFetchError('That host resolves to a private or unusable address.')
    }
    expect(await verifyRelMe('https://site.example/', ME, blocked)).toEqual({ ok: false, reason: 'That host resolves to a private or unusable address.' })
    const boom: Fetcher = async () => {
      throw new Error('socket detail that must not leak')
    }
    expect(await verifyRelMe('https://site.example/', ME, boom)).toEqual({ ok: false, reason: 'The page could not be checked.', transient: true })
  })
})

describe('GitHub OAuth', () => {
  const cfg = { clientId: 'cid', clientSecret: 'sec' }
  it('asks only for read:user', () => {
    const u = new URL(githubAuthorizeUrl(cfg, 'https://blueyvatar.com/account/claims/callback', 'st'))
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(u.searchParams.get('scope')).toBe('read:user')
    expect(u.searchParams.get('state')).toBe('st')
  })
  it('reads the login and compares case-insensitively', async () => {
    const f = (async (url: string) =>
      String(url).includes('access_token') ? Response.json({ access_token: 't' }) : Response.json({ login: 'OctoCat' })) as unknown as typeof fetch
    expect(await githubLogin(cfg, 'code', 'https://x/cb', f)).toBe('OctoCat')
    expect(githubClaimMatches('OctoCat', 'https://github.com/octocat')).toBe(true)
    expect(githubClaimMatches('someone', 'https://github.com/octocat')).toBe(false)
  })
  it('returns null when the exchange fails', async () => {
    const f = (async () => Response.json({ error: 'bad_verification_code' })) as unknown as typeof fetch
    expect(await githubLogin(cfg, 'code', 'https://x/cb', f)).toBeNull()
  })
})

describe('Mastodon OAuth', () => {
  const app: MastodonApp = { instance: 'mastodon.social', clientId: 'id', clientSecret: 'secret', redirectUri: 'https://blueyvatar.com/account/claims/callback' }
  const json = (status: number, body: unknown): Fetcher => async (url) => ({ status, url, text: JSON.stringify(body), headers: {} })
  it('registers an app per instance with the callback and a read scope', async () => {
    let seen: { url: string; body?: string } | undefined
    const f: Fetcher = async (url, o) => {
      seen = { url, body: o?.body }
      return { status: 200, url, text: JSON.stringify({ client_id: 'id', client_secret: 'secret' }), headers: {} }
    }
    expect(await registerApp('mastodon.social', app.redirectUri, 'https://blueyvatar.com', f)).toEqual(app)
    expect(seen?.url).toBe('https://mastodon.social/api/v1/apps')
    const p = new URLSearchParams(seen?.body)
    expect(p.get('redirect_uris')).toBe(app.redirectUri)
    expect(p.get('scopes')).toBe('read:accounts')
    expect(await registerApp('x.example', app.redirectUri, 'https://blueyvatar.com', json(422, {}))).toBeNull()
  })
  it('builds the authorize URL on the instance', () => {
    const u = new URL(authorizeUrl(app, 'st'))
    expect(u.origin + u.pathname).toBe('https://mastodon.social/oauth/authorize')
    expect(u.searchParams.get('client_id')).toBe('id')
    expect(u.searchParams.get('state')).toBe('st')
  })
  it('exchanges the code and reads the account URL', async () => {
    const f: Fetcher = async (url) => ({
      status: 200, url, headers: {},
      text: JSON.stringify(url.endsWith('/oauth/token') ? { access_token: 't' } : { url: 'https://mastodon.social/@Alice' }),
    })
    expect(await accountUrl(app, 'code', f)).toBe('https://mastodon.social/@Alice')
    expect(await accountUrl(app, 'code', json(400, { error: 'invalid_grant' }))).toBeNull()
  })
  it('matches only the same instance and user', () => {
    expect(mastodonClaimMatches('https://mastodon.social/@Alice', 'https://mastodon.social/@alice')).toBe(true)
    expect(mastodonClaimMatches('https://mastodon.social/users/alice', 'https://mastodon.social/@alice')).toBe(true)
    expect(mastodonClaimMatches('https://mastodon.social/@bob', 'https://mastodon.social/@alice')).toBe(false)
    expect(mastodonClaimMatches('https://evil.example/@alice', 'https://mastodon.social/@alice')).toBe(false)
  })
})

describe('attestation writers', () => {
  it('defaults to the local writer and uses the service repo when both variables are set', () => {
    expect(attestationWriterFromEnv({})).toBeInstanceOf(LocalAttestationWriter)
    expect(attestationWriterFromEnv({ SERVICE_REPO_DID: 'did:plc:svc' })).toBeInstanceOf(LocalAttestationWriter)
    expect(attestationWriterFromEnv({ SERVICE_REPO_DID: 'did:plc:svc', SERVICE_APP_PASSWORD: 'pw' })).toBeInstanceOf(AtprotoAttestationWriter)
  })
  it('local writer returns a placeholder reference', async () => {
    const r = await new LocalAttestationWriter().write()
    expect(r.uri.startsWith('local:attestation/')).toBe(true)
  })
  it('creates and deletes records in the service repo', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const f = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      calls.push({ url, body })
      if (url.endsWith('createSession')) return Response.json({ accessJwt: 'jwt' })
      return Response.json({ uri: 'at://did:plc:svc/com.blueyvatar.attestation/3abc', cid: 'bafy' })
    }) as unknown as typeof fetch
    const w = new AtprotoAttestationWriter({ did: 'did:plc:svc', password: 'pw', pds: 'https://pds.example' }, f)
    const ref = await w.write({ subject: { uri: 'at://did:plc:u/com.blueyvatar.claim/1', cid: 'c' }, result: 'verified', method: 'rel-me' })
    expect(ref.uri).toBe('at://did:plc:svc/com.blueyvatar.attestation/3abc')
    const create = calls.find((c) => c.url.endsWith('createRecord'))!
    expect(create.body).toMatchObject({ repo: 'did:plc:svc', collection: 'com.blueyvatar.attestation', record: { subject: { cid: 'c' }, result: 'verified', method: 'rel-me' } })
    await w.remove(ref.uri)
    expect(calls.at(-1)).toMatchObject({ url: 'https://pds.example/xrpc/com.atproto.repo.deleteRecord', body: { rkey: '3abc' } })
    const n = calls.length
    await w.remove('local:attestation/1')
    await w.remove('at://did:plc:other/com.blueyvatar.attestation/3abc')
    expect(calls.length).toBe(n)
  })
})

describe('claim store (memory)', () => {
  const row = (uri: string, result: 'verified' | 'revoked' = 'verified') => ({
    uri, cid: 'c', claimDid: 'did:plc:u', claimRkey: 'k1', claimCid: 'cc', claimUri: 'https://github.com/a', result, method: 'github-oauth', createdAt: new Date(),
  })
  it('supersedes earlier verified attestations and revokes on delete', async () => {
    const s = memoryClaimStore()
    expect(await s.recordVerified(row('local:1'))).toEqual([])
    expect(await s.recordVerified(row('local:2'))).toEqual(['local:1'])
    expect((await s.latestAttestations('did:plc:u')).map((a) => [a.uri, a.result])).toEqual([['local:2', 'verified']])
    expect(await s.revokeForClaim('did:plc:u', 'k1')).toEqual(['local:2'])
    expect((await s.latestAttestations('did:plc:u'))[0]?.result).toBe('revoked')
  })
  it('state is single use', async () => {
    const s = memoryClaimStore()
    await s.putState({ state: 'st', did: 'did:plc:u', rkey: 'k1', provider: 'github' })
    expect((await s.takeState('st'))?.rkey).toBe('k1')
    expect(await s.takeState('st')).toBeNull()
  })
})

describe('cooldown', () => {
  it('blocks repeats inside the window', () => {
    expect(coolingDown('k', 1000, 0)).toBe(false)
    expect(coolingDown('k', 1000, 500)).toBe(true)
    expect(coolingDown('k', 1000, 1500)).toBe(false)
  })
})
