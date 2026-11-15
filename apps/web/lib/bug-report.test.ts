import { describe, expect, it, vi } from 'vitest'
import {
  countLinks, feedbackConfig, isHoneypotFilled, issueBody, issueTitle, ISSUE_LABELS, MAX_DESCRIPTION, MAX_LINKS, MAX_REQUEST_BYTES, neutralize,
  pagePath, parseBugReport, screenshotProblem, SCREENSHOT_MAX_INPUT_BYTES, sentSummary, type BugReportInput,
} from './bug-report'
import sharp from 'sharp'
import { cleanScreenshot, decodeScreenshot } from './bug-report-screenshot'
import { runBugReport, type RunDeps } from './bug-report-run'
import { BUCKETS } from './rate-limit'

const good = { description: 'The avatar upload button does nothing on my phone.', contact: '', includeHandle: false, page: '/account/avatars?code=secret#x', userAgent: 'UA/1', viewportWidth: 390, viewportHeight: 844, hasScreenshot: false }
const input = (o: Partial<BugReportInput> = {}): BugReportInput => ({ description: 'It broke.', contact: '', includeHandle: false, page: '/pricing', userAgent: 'UA/1', viewport: '390x844', hasScreenshot: false, screenshot: '', ...o })

describe('feedbackConfig', () => {
  it('is null without the token, so the button stays hidden', () => {
    expect(feedbackConfig({})).toBeNull()
    expect(feedbackConfig({ GITHUB_FEEDBACK_TOKEN: '   ' })).toBeNull()
  })
  it('reads the token and repository from the environment, defaulting the repository', () => {
    expect(feedbackConfig({ GITHUB_FEEDBACK_TOKEN: 't' })).toEqual({ token: 't', repo: 'CdaerisAgency/BlueyVatar' })
    expect(feedbackConfig({ GITHUB_FEEDBACK_TOKEN: 't', GITHUB_FEEDBACK_REPO: 'me/test-repo' })?.repo).toBe('me/test-repo')
  })
  it('refuses a malformed repository name', () => {
    expect(feedbackConfig({ GITHUB_FEEDBACK_TOKEN: 't', GITHUB_FEEDBACK_REPO: '../../orgs/x' })).toBeNull()
    expect(feedbackConfig({ GITHUB_FEEDBACK_TOKEN: 't', GITHUB_FEEDBACK_REPO: 'noslash' })).toBeNull()
  })
})

describe('parseBugReport', () => {
  it('accepts a good report and keeps only the page path', () => {
    const r = parseBugReport(good)
    expect(r.ok && r.value.page).toBe('/account/avatars')
    expect(r.ok && r.value.viewport).toBe('390x844')
  })
  it('enforces the description length', () => {
    expect(parseBugReport({ ...good, description: 'short' })).toMatchObject({ ok: false, field: 'description' })
    expect(parseBugReport({ ...good, description: 'x'.repeat(MAX_DESCRIPTION + 1) })).toMatchObject({ ok: false, field: 'description' })
  })
  it('validates the optional contact email', () => {
    expect(parseBugReport({ ...good, contact: 'not an email' })).toMatchObject({ ok: false, field: 'contact' })
    expect(parseBugReport({ ...good, contact: 'a@b.co' })).toMatchObject({ ok: true })
  })
  it('rejects link spam', () => {
    const links = Array.from({ length: MAX_LINKS + 1 }, (_, i) => `https://x.example/${i}`).join(' ')
    expect(parseBugReport({ ...good, description: `Please visit ${links}` })).toMatchObject({ ok: false, field: 'description' })
    expect(countLinks('see www.a.com and http://b.com')).toBe(2)
  })
  it('rejects a body that is not an object', () => {
    for (const bad of [null, 'x', [], 4]) expect(parseBugReport(bad)).toMatchObject({ ok: false, field: 'body' })
  })
  it('detects the honeypot', () => {
    expect(isHoneypotFilled({ ...good, website: 'http://spam' })).toBe(true)
    expect(isHoneypotFilled({ ...good, website: '' })).toBe(false)
    expect(isHoneypotFilled(good)).toBe(false)
  })
})

describe('pagePath', () => {
  it('drops the query, fragment, and any origin', () => {
    expect(pagePath('/a/b?token=1#frag')).toBe('/a/b')
    expect(pagePath('https://evil.example/x?y=1')).toBe('')
    expect(pagePath(42)).toBe('')
  })
})

describe('issue text', () => {
  it('neutralizes mentions and issue references', () => {
    expect(neutralize('ping @octocat about #12')).not.toMatch(/@octocat|#12/)
    expect(neutralize('mail me at a@b.co')).toBe('mail me at a@b.co')
  })
  it('titles from the first line, trimmed', () => {
    expect(issueTitle('Upload fails\nmore detail')).toBe('Upload fails')
    expect(issueTitle('y'.repeat(300)).length).toBe(200)
  })
  it('keeps links, issue numbers, and mentions out of the title (conventions, section 2)', () => {
    expect(issueTitle('Avatar fails, see https://example.com/x?a=1 and #12 from @octocat')).toBe('Avatar fails, see and from octocat')
    expect(issueTitle('  \n  ')).toBe('Bug report')
  })
  it('omits the handle and contact unless given', () => {
    const body = issueBody(input(), { handle: null, version: 'v1' })
    expect(body).toContain('handle not shared')
    expect(body).not.toContain('Contact:')
    expect(body).toContain('window 390x844')
    expect(body).toContain('build `v1`')
  })
  it('names the handle and contact when the person agreed', () => {
    const body = issueBody(input({ contact: 'a@b.co' }), { handle: 'alice.test', version: null })
    expect(body).toContain('**alice.test**')
    expect(body).toContain('Contact: a@b.co')
  })
  it('links the screenshot for admins without embedding it', () => {
    const body = issueBody(input({ hasScreenshot: true }), { handle: null, version: null, screenshotUrl: 'https://x.test/admin/bug-reports/abc/screenshot' })
    expect(body).toContain('Screenshots: 1. Visible to signed-in admins only: https://x.test/admin/bug-reports/abc/screenshot')
    expect(body).not.toContain('![')
    expect(issueBody(input({ hasScreenshot: true }), { handle: null, version: null })).toContain('Screenshots: 0')
  })
  it('carries only the conventions kind label, no status labels', () => {
    expect([...ISSUE_LABELS]).toEqual(['bug'])
  })
  it('lists what is sent', () => {
    expect(sentSummary({ page: '/x', viewport: '1x1', hasContact: false, includeHandle: false })).toContain('No handle')
  })
})

describe('screenshotProblem', () => {
  it('accepts common image types within the size limit', () => {
    expect(screenshotProblem({ type: 'image/png', size: 1000 })).toBeNull()
  })
  it('refuses other types and oversize files', () => {
    expect(screenshotProblem({ type: 'application/pdf', size: 10 })).toMatch(/PNG, JPEG, or WebP/)
    expect(screenshotProblem({ type: 'image/svg+xml', size: 10 })).not.toBeNull()
    expect(screenshotProblem({ type: 'image/jpeg', size: SCREENSHOT_MAX_INPUT_BYTES + 1 })).toMatch(/MB/)
  })
})

describe('rate limits', () => {
  it('has per-account and per-network buckets', () => {
    expect(BUCKETS['bugReport.did'].limit).toBeGreaterThan(0)
    expect(BUCKETS['bugReport.ip'].limit).toBeGreaterThanOrEqual(BUCKETS['bugReport.did'].limit)
  })
})

describe('runBugReport', () => {
  const ok = () => new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/issues/7' }), { status: 201 })
  const deps = (o: Partial<RunDeps> = {}): RunDeps => ({
    did: 'did:plc:abc', config: { token: 'SECRET-TOKEN', repo: 'o/r' }, limited: async () => null, handleFor: async () => 'alice.test',
    version: 'v1', fetchImpl: vi.fn(async () => ok()) as unknown as typeof fetch, report: vi.fn(), screenshots: null, ...o,
  })
  const body = JSON.stringify(good)

  it('requires a signed-in account', async () => {
    const d = deps({ did: null })
    expect((await runBugReport(body, d)).status).toBe(401)
    expect(d.fetchImpl).not.toHaveBeenCalled()
  })
  it('answers 503 and calls nothing when the token is unset', async () => {
    const d = deps({ config: null })
    const r = await runBugReport(body, d)
    expect(r.status).toBe(503)
    expect(d.fetchImpl).not.toHaveBeenCalled()
  })
  it('files an issue with the token in the header only, labels, and no handle by default', async () => {
    const d = deps()
    const r = await runBugReport(body, d)
    expect(r).toEqual({ status: 200, body: { ok: true, number: 7, url: 'https://github.com/o/r/issues/7' } })
    const [url, init] = (d.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/o/r/issues')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer SECRET-TOKEN')
    const sent = JSON.parse(String(init.body)) as { title: string; body: string; labels: string[] }
    expect(sent.labels).toEqual(['bug'])
    expect(sent.body).not.toContain('SECRET-TOKEN')
    expect(sent.body).not.toContain('alice.test')
    expect(sent.body).not.toContain('did:plc')
    expect(sent.body).toContain('`/account/avatars`')
  })
  it('names the handle only with consent, falling back to the account ID', async () => {
    const d = deps()
    await runBugReport(JSON.stringify({ ...good, includeHandle: true }), d)
    expect(String(((d.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body)).toContain('alice.test')
    const d2 = deps({ handleFor: async () => null })
    await runBugReport(JSON.stringify({ ...good, includeHandle: true }), d2)
    expect(String(((d2.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body)).toContain('did:plc:abc')
  })
  it('refuses with 429 and a retry time when limited, before filing anything', async () => {
    const d = deps({ limited: async () => 120 })
    const r = await runBugReport(body, d)
    expect(r.status).toBe(429)
    expect(r.status === 429 && r.retryAfterSec).toBe(120)
    expect(d.fetchImpl).not.toHaveBeenCalled()
  })
  it('files nothing and reports success to a bot that filled the honeypot', async () => {
    const d = deps()
    const r = await runBugReport(JSON.stringify({ ...good, website: 'x' }), d)
    expect(r.status).toBe(200)
    expect(d.fetchImpl).not.toHaveBeenCalled()
  })
  it('rejects bad input and oversize bodies without calling GitHub', async () => {
    const d = deps()
    expect((await runBugReport(JSON.stringify({ ...good, description: 'no' }), d)).status).toBe(400)
    expect((await runBugReport('{not json', d)).status).toBe(400)
    expect((await runBugReport('x'.repeat(MAX_REQUEST_BYTES + 1), d)).status).toBe(413)
    expect(d.fetchImpl).not.toHaveBeenCalled()
  })
  it('returns 502 and logs only the status when GitHub refuses', async () => {
    const d = deps({ fetchImpl: vi.fn(async () => new Response('Bad credentials SECRET-TOKEN', { status: 401 })) as unknown as typeof fetch })
    const r = await runBugReport(body, d)
    expect(r.status).toBe(502)
    expect(JSON.stringify(r)).not.toContain('SECRET-TOKEN')
    const logged = (d.report as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Error
    expect(logged.message).toBe('GitHub issue create failed: 401')
  })
  it('returns 502 when the network fails', async () => {
    const d = deps({ fetchImpl: vi.fn(async () => { throw new TypeError('boom SECRET-TOKEN') }) as unknown as typeof fetch })
    const r = await runBugReport(body, d)
    expect(r.status).toBe(502)
    expect(((d.report as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Error).message).not.toContain('SECRET-TOKEN')
  })
})

describe('screenshot cleaning', () => {
  it('re-encodes to a JPEG without metadata and within the size cap', async () => {
    const png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#336699' } }).withMetadata({ exif: { IFD0: { Copyright: 'someone' } } }).jpeg().toBuffer()
    expect((await sharp(png).metadata()).exif).toBeDefined()
    const out = await cleanScreenshot(png)
    expect(out).not.toBeNull()
    const meta = await sharp(out!).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.exif).toBeUndefined()
    expect(Math.max(meta.width!, meta.height!)).toBe(1600)
    expect(out!.length).toBeLessThanOrEqual(1024 * 1024)
  })
  it('refuses bytes that are not a PNG, JPEG, or WebP picture', async () => {
    expect(await cleanScreenshot(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(await cleanScreenshot(Buffer.from('%PDF-1.4'))).toBeNull()
  })
  it('decodes base64 and refuses junk or oversize input', () => {
    expect(decodeScreenshot(Buffer.from('hello').toString('base64'), 100)?.toString()).toBe('hello')
    expect(decodeScreenshot('data:image/png;base64,' + Buffer.from('hi').toString('base64'), 100)?.toString()).toBe('hi')
    expect(decodeScreenshot('not base64!!', 100)).toBeNull()
    expect(decodeScreenshot(Buffer.alloc(200).toString('base64'), 100)).toBeNull()
    expect(decodeScreenshot('', 100)).toBeNull()
  })
})

describe('runBugReport with a screenshot', () => {
  const ok = () => new Response(JSON.stringify({ number: 9, html_url: 'https://github.com/o/r/issues/9' }), { status: 201 })
  const store = () => ({ save: vi.fn(async () => 'SHOTID12345678901234567'), discard: vi.fn(async () => {}), attach: vi.fn(async () => {}), baseUrl: 'https://bv.test/' })
  const mk = (screenshots: ReturnType<typeof store> | null, fetchImpl: typeof fetch): RunDeps => ({
    did: 'did:plc:abc', config: { token: 'T', repo: 'o/r' }, limited: async () => null, handleFor: async () => null, version: null, fetchImpl, report: vi.fn(), screenshots,
  })
  const withShot = async () => JSON.stringify({ ...good, hasScreenshot: true, screenshot: (await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).png().toBuffer()).toString('base64') })

  it('stores the cleaned picture, links it in the issue, and records the issue number', async () => {
    const s = store()
    const f = vi.fn(async () => ok()) as unknown as typeof fetch
    expect((await runBugReport(await withShot(), mk(s, f))).status).toBe(200)
    expect(s.save).toHaveBeenCalledOnce()
    expect(((s.save.mock.calls[0] as unknown) as [string, Buffer])[1].subarray(0, 2).toString('hex')).toBe('ffd8')
    const sent = JSON.parse(String((vi.mocked(f).mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { body: string }
    expect(sent.body).toContain('https://bv.test/admin/bug-reports/SHOTID12345678901234567/screenshot')
    expect(s.attach).toHaveBeenCalledWith('SHOTID12345678901234567', 9)
  })
  it('refuses a screenshot that is not a picture, before filing anything', async () => {
    const s = store()
    const f = vi.fn(async () => ok()) as unknown as typeof fetch
    const r = await runBugReport(JSON.stringify({ ...good, screenshot: Buffer.from('<svg/>').toString('base64') }), mk(s, f))
    expect(r).toMatchObject({ status: 400, body: { field: 'screenshot' } })
    expect(s.save).not.toHaveBeenCalled()
    expect(f).not.toHaveBeenCalled()
  })
  it('deletes the stored picture when GitHub refuses the issue', async () => {
    const s = store()
    const f = vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch
    expect((await runBugReport(await withShot(), mk(s, f))).status).toBe(502)
    expect(s.discard).toHaveBeenCalledWith('SHOTID12345678901234567')
  })
})
