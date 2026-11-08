import { describe, expect, it } from 'vitest'
import { deviceHint } from './device'
import { avatarUrl, imgSnippet, markdownSnippet } from './avatar-snippets'
import { DEFAULT_NEXT, loginPath, safeNext } from './next-path'
import { DANGER_ZONE, SETTINGS_GROUPS, SETTINGS_LINKS, currentHref } from './settings-hub'
import { memoryStore, SESSION_TOUCH_MS } from './store'
import { SESSION_TTL_MS, parseSession, readSession, signSession } from './session-cookie'

const DID = 'did:web:alice.example.com'
const SID = 's' + 'A'.repeat(22)

describe('safeNext', () => {
  it('keeps same-site account paths', () => {
    expect(safeNext('/account/keys')).toBe('/account/keys')
    expect(safeNext('/p/alice.bsky.social')).toBe('/p/alice.bsky.social')
    expect(safeNext('/a/alice.bsky.social')).toBe('/a/alice.bsky.social')
    expect(safeNext('/p/a/b')).toBe(DEFAULT_NEXT)
    expect(safeNext('/p//evil.test')).toBe(DEFAULT_NEXT)
    expect(safeNext('/account/avatars?error=x')).toBe('/account/avatars?error=x')
  })
  it('falls back for anything else', () => {
    for (const bad of [undefined, '', 'https://evil.test', '//evil.test', '/\\evil', '/login', '/accounts', '/account//x', '/account/../x', '/account@evil.test', '/account/x#frag', 'javascript:alert(1)', '/account/' + 'a'.repeat(400)]) {
      expect(safeNext(bad)).toBe(DEFAULT_NEXT)
    }
  })
  it('builds a login path only when there is somewhere to return to', () => {
    expect(loginPath('/account')).toBe('/login')
    expect(loginPath('/account/keys')).toBe('/login?next=%2Faccount%2Fkeys')
    expect(loginPath('//evil.test')).toBe('/login')
  })
})

describe('session cookie with session ids', () => {
  it('round-trips a DID that contains dots', () => {
    const c = signSession(DID, 'k', 1000, SID)
    expect(parseSession(c, 'k', 2000)).toEqual({ did: DID, sid: SID, issuedAt: 1000 })
    expect(readSession(c, 'k', 2000)).toBe(DID)
  })
  it('still reads cookies issued without a session id', () => {
    const c = signSession(DID, 'k', 1000)
    expect(parseSession(c, 'k', 2000)).toEqual({ did: DID, sid: null, issuedAt: 1000 })
  })
  it('rejects tampering, a wrong key, and expiry', () => {
    const c = signSession(DID, 'k', 1000, SID)
    expect(parseSession(c.replace(SID, 's' + 'B'.repeat(22)), 'k', 2000)).toBeNull()
    expect(parseSession(c, 'other', 2000)).toBeNull()
    expect(parseSession(c, 'k', 1000 + SESSION_TTL_MS)).toBeNull()
  })
})

describe('web sessions (memory store)', () => {
  it('lists newest first, and a cookie needs its row', async () => {
    let now = 1_000_000
    const s = memoryStore(() => now).sessions
    const a = await s.create(DID, 'Firefox on Linux')
    now += 1000
    const b = await s.create(DID, 'Safari on iOS')
    expect((await s.list(DID)).map((x) => x.id)).toEqual([b, a])
    expect(await s.valid(DID, a, now)).toBe(true)
    expect(await s.valid('did:plc:other', a, now)).toBe(false)
    expect(await s.valid(DID, 'sMissing', now)).toBe(false)
  })
  it('refreshes last use at most once per touch interval', async () => {
    let now = 1_000_000
    const s = memoryStore(() => now).sessions
    const a = await s.create(DID, 'x')
    now += SESSION_TOUCH_MS - 1
    await s.valid(DID, a, now)
    expect((await s.list(DID))[0]!.lastUsedAt.getTime()).toBe(1_000_000)
    now += 1
    await s.valid(DID, a, now)
    expect((await s.list(DID))[0]!.lastUsedAt.getTime()).toBe(now)
  })
  it('revokes one session only for its owner', async () => {
    const s = memoryStore().sessions
    const a = await s.create(DID, 'x')
    expect(await s.revoke('did:plc:other', a)).toBe(false)
    expect(await s.revoke(DID, a)).toBe(true)
    expect(await s.valid(DID, a, Date.now())).toBe(false)
  })
  it('sign out everywhere ends tracked and older cookies but not new sign-ins', async () => {
    let now = 5_000
    const s = memoryStore(() => now).sessions
    const a = await s.create(DID, 'x')
    await s.create(DID, 'y')
    const other = await s.create('did:plc:other', 'z')
    now = 6_000
    expect(await s.revokeAll(DID)).toBe(2)
    expect(await s.list(DID)).toEqual([])
    expect(await s.valid(DID, a, 5_000)).toBe(false)
    expect(await s.valid(DID, null, 5_500)).toBe(false)
    expect(await s.valid('did:plc:other', other, 5_000)).toBe(true)
    now = 7_000
    const fresh = await s.create(DID, 'w')
    expect(await s.valid(DID, fresh, 7_000)).toBe(true)
    expect(await s.valid(DID, null, 7_000)).toBe(true)
  })
})

describe('deviceHint', () => {
  it('names browser and OS, and nothing else', () => {
    expect(deviceHint('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox on Linux')
    expect(deviceHint('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe('Safari on macOS')
    expect(deviceHint('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('Edge on Windows')
    expect(deviceHint('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS')
    expect(deviceHint('curl/8.0')).toBe('Unknown device')
    expect(deviceHint(null)).toBe('Unknown device')
  })
})

describe('settings hub', () => {
  it('lists each route once in the four groups plus the danger zone', () => {
    expect(SETTINGS_GROUPS.map((g) => g.title)).toEqual(['Profile', 'Privacy', 'Developer', 'Billing'])
    expect(SETTINGS_LINKS).toContain(DANGER_ZONE)
    const hrefs = SETTINGS_LINKS.map((l) => l.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    for (const l of SETTINGS_LINKS) expect(l.description.length).toBeGreaterThan(10)
  })
  it('highlights the longest matching route, and /account only exactly', () => {
    const hrefs = ['/account', '/account/avatars', '/account/settings']
    expect(currentHref('/account', hrefs)).toBe('/account')
    expect(currentHref('/account/', hrefs)).toBe('/account')
    expect(currentHref('/account/avatars/import', hrefs)).toBe('/account/avatars')
    expect(currentHref('/account/settings', hrefs)).toBe('/account/settings')
    expect(currentHref('/account/verify', hrefs)).toBeNull()
  })
})

describe('avatar snippets', () => {
  const hash = 'a'.repeat(64)
  it('builds the URL and both embeds', () => {
    const url = avatarUrl('https://blueyvatar.com/', hash)
    expect(url).toBe(`https://blueyvatar.com/avatar/${hash}?s=200`)
    expect(imgSnippet(url)).toBe(`<img src="${url}" width="200" height="200" alt="Avatar">`)
    expect(markdownSnippet(url)).toBe(`![Avatar](${url})`)
  })
})
