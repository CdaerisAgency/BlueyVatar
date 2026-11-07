import { describe, expect, it } from 'vitest'
import { ATTRIBUTION_SNIPPET, checkAttribution, detectAttribution, validateAttributionSite } from './attribution.js'
import type { Fetcher } from './safe-fetch.js'

const B = 'https://site.example/'
const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`

describe('detectAttribution', () => {
  it('accepts the published snippet', () => {
    expect(detectAttribution(page(ATTRIBUTION_SNIPPET), B)).toBe('found')
  })
  it('accepts www, http, a path, single quotes, and upper case', () => {
    for (const a of [
      `<a href="https://www.blueyvatar.com/">x</a>`,
      `<a href='http://blueyvatar.com/pricing'>x</a>`,
      `<A HREF="HTTPS://BLUEYVATAR.COM">x</A>`,
      `<a class="c" href=https://blueyvatar.com>x</a>`,
    ]) expect(detectAttribution(page(a), B)).toBe('found')
  })
  it('accepts harmless rel values', () => {
    expect(detectAttribution(page(`<a rel="noopener noreferrer" href="https://blueyvatar.com">x</a>`), B)).toBe('found')
    expect(detectAttribution(page(`<a rel="external" href="https://blueyvatar.com">x</a>`), B)).toBe('found')
  })
  it('reports nofollow, ugc, and sponsored as not followable', () => {
    for (const rel of ['nofollow', 'NoFollow noopener', 'ugc', 'sponsored', 'noopener  nofollow']) {
      expect(detectAttribution(page(`<a rel="${rel}" href="https://blueyvatar.com">x</a>`), B)).toBe('nofollow')
    }
  })
  it('a followable link anywhere wins over a nofollow one', () => {
    const html = page(`<a rel="nofollow" href="https://blueyvatar.com">a</a><a href="https://blueyvatar.com/docs">b</a>`)
    expect(detectAttribution(html, B)).toBe('found')
  })
  it('does not match look-alike hosts, other schemes, or link elements', () => {
    for (const a of [
      `<a href="https://blueyvatar.com.evil.example/">x</a>`,
      `<a href="https://notblueyvatar.com/">x</a>`,
      `<a href="https://img.blueyvatar.com/avatar/x">x</a>`,
      `<a href="mailto:hi@blueyvatar.com">x</a>`,
      `<a href="/blueyvatar.com">x</a>`,
      `<link rel="canonical" href="https://blueyvatar.com">`,
      `<a>no href</a>`,
    ]) expect(detectAttribution(page(a), B)).toBe('missing')
  })
  it('ignores commented-out and scripted links', () => {
    expect(detectAttribution(page(`<!-- <a href="https://blueyvatar.com">x</a> -->`), B)).toBe('missing')
    expect(detectAttribution(page(`<script>var s='<a href="https://blueyvatar.com">x</a>'</script>`), B)).toBe('missing')
  })
  it('resolves relative hrefs against the page', () => {
    expect(detectAttribution(page(`<a href="//blueyvatar.com/">x</a>`), B)).toBe('found')
  })
})

describe('checkAttribution', () => {
  const fx = (status: number, text: string): Fetcher => async (url) => ({ status, url, text, headers: {} })
  it('finds the link on a fixture page', async () => {
    expect(await checkAttribution(B, fx(200, page(ATTRIBUTION_SNIPPET)))).toBe('found')
  })
  it('reports a page without the link as missing', async () => {
    expect(await checkAttribution(B, fx(200, page('<p>hello</p>')))).toBe('missing')
  })
  it('reports a nofollow link', async () => {
    expect(await checkAttribution(B, fx(200, page('<a rel="nofollow" href="https://blueyvatar.com">x</a>')))).toBe('nofollow')
  })
  it('treats errors and non-2xx answers as unreachable, not as a failure', async () => {
    expect(await checkAttribution(B, fx(503, ''))).toBe('unreachable')
    expect(await checkAttribution(B, fx(404, ''))).toBe('unreachable')
    expect(await checkAttribution(B, async () => { throw new Error('down') })).toBe('unreachable')
  })
  it('never fetches an address that is not public https', async () => {
    let called = false
    const f: Fetcher = async (url) => { called = true; return { status: 200, url, text: '', headers: {} } }
    expect(await checkAttribution('http://site.example/', f)).toBe('unreachable')
    expect(await checkAttribution('https://127.0.0.1/', f)).toBe('unreachable')
    expect(called).toBe(false)
  })
})

describe('validateAttributionSite', () => {
  it('accepts a public https address and drops the fragment', () => {
    expect(validateAttributionSite(' https://example.com/blog#x ')).toEqual({ ok: true, value: 'https://example.com/blog' })
  })
  it('refuses empty, http, local, and credentialed addresses', () => {
    for (const v of ['', 'http://example.com', 'https://localhost/', 'https://192.168.0.1/', 'https://u:p@example.com/', 'example.com']) {
      expect(validateAttributionSite(v).ok).toBe(false)
    }
  })
})
